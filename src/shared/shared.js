// Ortak alanlar: Firebase (e-posta/şifre girişi + Firestore) ile arkadaşlarınla gerçek zamanlı paylaşım.
// `npm run build:shared` ile shared.bundle.js dosyasına paketlenir ve window.sharedIdeas olarak açılır.
// Yetkiler (kim okur, kim düzenler, kim siler) firestore.rules içinde sunucu tarafında zorunlu kılınır.
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail, updateProfile, linkWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy,
  writeBatch, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import firebaseConfig from './firebase-config.js';

const configured = Boolean(firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('BURAYA') && firebaseConfig.projectId);

const HEARTBEAT_MS = 60 * 1000;
const PRESENCE_RETRY_MS = 2 * 60 * 1000;
const VERIFY_POLL_MS = 5 * 1000;

let auth = null;
let db = null;

// Aktif alan
let roomId = null;
let roomRef = null;
let membersRef = null;
let ideasRef = null;
let notesRef = null;
let roomUnsubs = [];
let connectId = 0;
let heartbeatTimer = null;
let retryTimer = null;

// Lobi (alanlarım + davetlerim)
let invitesUnsub = null;
let verifyTimer = null;

// Odak süresi (renderer her saniye günceller; üye kaydına dakikada bir yazılır)
let focusStats = null;
let lastSentFocusKey = '';

const listeners = new Set();
let current = {
  status: configured ? 'idle' : 'unconfigured',
  authReady: false,
  user: null,
  activeRoomId: null,
  room: null,
  ideas: [],
  notes: [],
  members: [],
  membersError: '',
  error: '',
  fromCache: false,
  pending: false,
  myRooms: [],
  roomsLoading: false,
  invites: [],
};

function emit(patch) {
  current = { ...current, ...patch };
  for (const fn of listeners) fn(current);
}

const toMs = (v) => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : Date.now());
const normEmail = (e) => String(e || '').trim().toLowerCase();

function explain(err) {
  const code = (err && err.code) || '';
  const messages = {
    'permission-denied': 'Bu işlem için yetkin yok.',
    'unavailable': 'İnternet bağlantısı yok. Bağlantı gelince tekrar denenecek.',
    'auth/network-request-failed': 'İnternet bağlantısı yok.',
    'auth/email-already-in-use': 'Bu e-postayla zaten bir hesap var. "Giriş yap" sekmesini kullan.',
    'auth/credential-already-in-use': 'Bu e-postayla zaten bir hesap var. "Giriş yap" sekmesini kullan.',
    'auth/invalid-email': 'Geçersiz e-posta adresi.',
    'auth/missing-email': 'E-posta adresini yaz.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/missing-password': 'Şifreni yaz.',
    'auth/invalid-credential': 'E-posta ya da şifre hatalı.',
    'auth/wrong-password': 'E-posta ya da şifre hatalı.',
    'auth/user-not-found': 'E-posta ya da şifre hatalı.',
    'auth/user-disabled': 'Bu hesap devre dışı bırakılmış.',
    'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.',
    'auth/operation-not-allowed': 'Firebase\'de E-posta/Şifre girişi kapalı. Authentication → Sign-in method bölümünden aç.',
  };
  if (messages[code]) return messages[code];
  if (code.startsWith('auth/api-key') || code === 'auth/invalid-api-key') return 'Firebase ayarları hatalı (apiKey).';
  return (err && err.message) || 'Bilinmeyen bir hata oluştu.';
}

function friendlyError(err) {
  const e = new Error(explain(err));
  e.code = err && err.code;
  return e;
}

// Yazma hataları anlık görüntüyü bozmaz; arayüz bunları bildirim olarak gösterir.
function writeFail(err) {
  console.error('[ortak alan]', err);
  emit({ writeError: { message: explain(err), at: Date.now() } });
}

/* ---------- Hesap ---------- */

const mapUser = (u) => (u ? {
  uid: u.uid,
  email: u.email || '',
  name: u.displayName || (u.email ? u.email.split('@')[0] : ''),
  verified: !!u.emailVerified,
  anonymous: !!u.isAnonymous,
} : null);

const me = () => mapUser(auth && auth.currentUser);
const isVerified = () => { const u = me(); return !!(u && u.verified && !u.anonymous); };

function onUserChanged() {
  const user = me();
  emit({ authReady: true, user });
  stopVerifyPoll();
  if (user && !user.anonymous && !user.verified) startVerifyPoll();
  if (isVerified()) startLobby();
  else { stopLobby(); disconnect(); }
}

async function register(name, email, password) {
  email = normEmail(email);
  try {
    let cred;
    // Daha önce anonim kullandıysan aynı kimliği koru: eski fikirlerin ve üyeliğin senin kalır.
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      cred = await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
    } else {
      cred = await createUserWithEmailAndPassword(auth, email, password);
    }
    await updateProfile(cred.user, { displayName: name });
    await sendEmailVerification(cred.user);
    onUserChanged();
  } catch (err) {
    throw friendlyError(err);
  }
}

async function login(email, password) {
  try {
    await signInWithEmailAndPassword(auth, normEmail(email), password);
  } catch (err) {
    throw friendlyError(err);
  }
}

async function logout() {
  disconnect();
  stopLobby();
  await signOut(auth);
}

async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, normEmail(email));
  } catch (err) {
    throw friendlyError(err);
  }
}

async function resendVerification() {
  try {
    await sendEmailVerification(auth.currentUser);
  } catch (err) {
    throw friendlyError(err);
  }
}

// Kullanıcı e-postadaki bağlantıya tıkladı mı? Tıkladıysa jetonu yenile ki kurallar "doğrulanmış" görsün.
async function checkVerified() {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return false;
  try {
    await u.reload();
    if (u.emailVerified) {
      await u.getIdToken(true);
      onUserChanged();
      return true;
    }
  } catch (err) {
    console.warn('[hesap]', err);
  }
  return false;
}

function startVerifyPoll() {
  stopVerifyPoll();
  verifyTimer = setInterval(checkVerified, VERIFY_POLL_MS);
}

function stopVerifyPoll() {
  clearInterval(verifyTimer);
  verifyTimer = null;
}

/* ---------- Lobi: alanlarım ve davetlerim ---------- */

function startLobby() {
  if (invitesUnsub || !isVerified()) return;
  const user = me();
  invitesUnsub = onSnapshot(
    query(collection(db, 'invites'), where('email', '==', user.email)),
    (snap) => emit({
      invites: snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: toMs(d.data().createdAt) })),
    }),
    (err) => console.warn('[davetler]', err),
  );
  loadMyRooms();
}

function stopLobby() {
  if (invitesUnsub) invitesUnsub();
  invitesUnsub = null;
  emit({ invites: [], myRooms: [] });
}

async function loadMyRooms() {
  if (!isVerified()) return;
  emit({ roomsLoading: true });
  try {
    const snap = await getDoc(doc(db, 'users', me().uid));
    const ids = snap.exists() ? snap.data().rooms || [] : [];
    const rooms = await Promise.all(ids.map((id) =>
      getDoc(doc(db, 'rooms', id))
        .then((s) => (s.exists() ? { id, name: s.data().name, ownerUid: s.data().ownerUid } : null))
        .catch(() => null))); // çıkarıldıysan artık okuyamazsın
    emit({ myRooms: rooms.filter(Boolean), roomsLoading: false });
  } catch (err) {
    console.warn('[alanlarım]', err);
    emit({ roomsLoading: false });
  }
}

const addMyRoom = (id) => setDoc(doc(db, 'users', me().uid), { rooms: arrayUnion(id) }, { merge: true });
const removeMyRoom = (id) => setDoc(doc(db, 'users', me().uid), { rooms: arrayRemove(id) }, { merge: true });

/* ---------- Üye kaydı ve "buradayım" sinyali ---------- */

function focusFields() {
  const f = focusStats;
  if (!f) return {};
  const base = { focusDate: f.date, focusWeekStart: f.weekStart, focusShared: !!f.shared };
  if (!f.shared) return { ...base, focusToday: 0, focusWeek: 0, focusRunning: false };
  return {
    ...base,
    focusToday: Math.min(86400, Math.max(0, Math.round(f.today))),
    focusWeek: Math.min(604800, Math.max(0, Math.round(f.week))),
    focusRunning: !!f.running,
  };
}

function memberData() {
  const user = me();
  return { uid: user.uid, name: user.name.slice(0, 40) || 'İsimsiz', email: user.email, lastSeen: serverTimestamp(), ...focusFields() };
}

function heartbeat() {
  // Çevrimdışıyken yazma kuyruğu biriktirmesin.
  if (!membersRef || !isVerified() || !navigator.onLine) return;
  lastSentFocusKey = focusKey();
  setDoc(doc(membersRef, me().uid), memberData(), { merge: true })
    .catch((err) => console.warn('[alandakiler]', err));
}

const focusKey = () => (focusStats ? `${focusStats.running}|${focusStats.shared}|${focusStats.date}` : '');

// Zamanlayıcı başlayınca/durunca ya da paylaşım ayarı değişince beklemeden bildir.
function setFocusStats(stats) {
  focusStats = stats;
  if (membersRef && focusKey() !== lastSentFocusKey) heartbeat();
}

function stopPresence() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function startPresence(myId) {
  heartbeat();
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  const unsub = onSnapshot(
    membersRef,
    (snap) => {
      const members = snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return {
          uid: d.id,
          name: x.name || '?',
          email: x.email || '',
          lastSeen: toMs(x.lastSeen),
          focusDate: x.focusDate || '',
          focusWeekStart: x.focusWeekStart || '',
          focusToday: x.focusToday || 0,
          focusWeek: x.focusWeek || 0,
          focusRunning: !!x.focusRunning,
          focusShared: x.focusShared !== false,
        };
      });
      emit({ members, membersError: '' });
    },
    (err) => {
      // Kurallar yeni yayınlandıysa açık bağlantılara ulaşması birkaç dakika sürebilir; sonra tekrar dene.
      console.warn('[alandakiler]', err);
      stopPresence();
      retryTimer = setTimeout(() => { if (myId === connectId && membersRef) startPresence(myId); }, PRESENCE_RETRY_MS);
      emit({ members: [], membersError: 'Kişi listesine şu an erişilemiyor. 2 dakika sonra tekrar denenecek.' });
    },
  );
  roomUnsubs.push(unsub);
}

/* ---------- Alan bağlantısı ---------- */

function disconnect() {
  connectId++;
  for (const unsub of roomUnsubs) unsub();
  roomUnsubs = [];
  stopPresence();
  roomId = roomRef = membersRef = ideasRef = notesRef = null;
  if (configured) {
    emit({ status: 'idle', activeRoomId: null, room: null, ideas: [], notes: [], members: [], membersError: '', error: '', fromCache: false, pending: false });
  }
}

function roomError(err) {
  console.error('[ortak alan]', err);
  const denied = err && err.code === 'permission-denied';
  emit({ status: 'error', error: denied ? 'Bu alana erişimin yok. Alandan çıkarılmış olabilirsin.' : explain(err) });
}

function connect(id) {
  if (!configured || !isVerified()) return;
  disconnect();
  const myId = connectId;
  roomId = id;
  roomRef = doc(db, 'rooms', id);
  membersRef = collection(roomRef, 'members');
  ideasRef = collection(roomRef, 'ideas');
  notesRef = collection(roomRef, 'notes');
  emit({ status: 'connecting', activeRoomId: id });

  roomUnsubs.push(onSnapshot(roomRef, (snap) => {
    if (snap.exists()) emit({ room: { id, name: snap.data().name, ownerUid: snap.data().ownerUid } });
  }, roomError));

  roomUnsubs.push(onSnapshot(
    query(ideasRef, orderBy('createdAt', 'desc')),
    { includeMetadataChanges: true },
    (snap) => {
      const ideas = snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return {
          id: d.id,
          title: x.title || '',
          desc: x.desc || '',
          author: x.author || '?',
          authorUid: x.authorUid || '',
          createdAt: toMs(x.createdAt),
          updatedAt: toMs(x.updatedAt),
        };
      });
      emit({ status: 'connected', ideas, error: '', fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
    },
    roomError,
  ));

  roomUnsubs.push(onSnapshot(query(notesRef, orderBy('createdAt', 'asc')), (snap) => {
    emit({
      notes: snap.docs.map((d) => {
        const x = d.data({ serverTimestamps: 'estimate' });
        return { id: d.id, ideaId: x.ideaId, text: x.text || '', author: x.author || '?', authorUid: x.authorUid || '', createdAt: toMs(x.createdAt) };
      }),
    });
  }, (err) => console.warn('[notlar]', err)));

  startPresence(myId);
}

async function createRoom(name) {
  const ref = doc(collection(db, 'rooms'));
  try {
    const batch = writeBatch(db);
    batch.set(ref, { name, ownerUid: me().uid, createdAt: serverTimestamp() });
    batch.set(doc(ref, 'members', me().uid), memberData());
    await batch.commit();
    await addMyRoom(ref.id);
    loadMyRooms();
    return ref.id;
  } catch (err) {
    throw friendlyError(err);
  }
}

async function acceptInvite(invite) {
  const ref = doc(db, 'rooms', invite.roomId);
  try {
    const batch = writeBatch(db);
    batch.set(doc(ref, 'members', me().uid), memberData(), { merge: true });
    batch.delete(doc(db, 'invites', invite.id));
    await batch.commit();
    await addMyRoom(invite.roomId);
    loadMyRooms();
    return invite.roomId;
  } catch (err) {
    throw friendlyError(err);
  }
}

function declineInvite(invite) {
  return deleteDoc(doc(db, 'invites', invite.id)).catch((err) => { throw friendlyError(err); });
}

async function leaveRoom() {
  const id = roomId;
  const uid = me().uid;
  disconnect();
  try {
    await deleteDoc(doc(db, 'rooms', id, 'members', uid));
    await removeMyRoom(id);
  } catch (err) {
    writeFail(err);
  }
  loadMyRooms();
}

function removeMember(uid) {
  if (!membersRef) return;
  deleteDoc(doc(membersRef, uid)).catch(writeFail);
}

async function invite(email) {
  if (!roomId) return;
  email = normEmail(email);
  const user = me();
  try {
    await setDoc(doc(db, 'invites', `${roomId}_${email}`), {
      email,
      roomId,
      roomName: (current.room && current.room.name) || 'Ortak Alan',
      invitedBy: user.name.slice(0, 40) || 'Bir arkadaşın',
      invitedByUid: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    throw friendlyError(err);
  }
}

/* ---------- Fikirler ve notlar ---------- */
// Yazmalar beklenmez: Firestore değişikliği önce yerelde gösterir, sonra sunucuya iletir.

function add(fields) {
  if (!ideasRef) return null;
  const user = me();
  const ref = doc(ideasRef);
  setDoc(ref, {
    title: fields.title,
    desc: fields.desc,
    author: user.name.slice(0, 40) || 'İsimsiz',
    authorUid: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch(writeFail);
  return ref.id;
}

function update(id, fields) {
  if (!ideasRef) return;
  updateDoc(doc(ideasRef, id), { title: fields.title, desc: fields.desc, updatedAt: serverTimestamp() }).catch(writeFail);
}

function remove(id) {
  if (!ideasRef) return;
  deleteDoc(doc(ideasRef, id)).catch(writeFail);
}

// "Geri al": silinen fikri aynı kimlikle geri yaz (notları da kimliğe bağlı olduğu için geri gelir).
function restore(idea) {
  if (!ideasRef) return;
  setDoc(doc(ideasRef, idea.id), {
    title: idea.title,
    desc: idea.desc,
    author: idea.author,
    authorUid: idea.authorUid,
    createdAt: Timestamp.fromMillis(idea.createdAt),
    updatedAt: serverTimestamp(),
  }).catch(writeFail);
}

function addNote(ideaId, text) {
  if (!notesRef) return;
  const user = me();
  setDoc(doc(notesRef), {
    ideaId,
    text,
    author: user.name.slice(0, 40) || 'İsimsiz',
    authorUid: user.uid,
    createdAt: serverTimestamp(),
  }).catch(writeFail);
}

function removeNote(id) {
  if (!notesRef) return;
  deleteDoc(doc(notesRef, id)).catch(writeFail);
}

function restoreNote(note) {
  if (!notesRef) return;
  setDoc(doc(notesRef, note.id), {
    ideaId: note.ideaId,
    text: note.text,
    author: note.author,
    authorUid: note.authorUid,
    createdAt: Timestamp.fromMillis(note.createdAt),
  }).catch(writeFail);
}

/* ---------- Başlat ---------- */

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'tr'; // doğrulama ve şifre sıfırlama e-postaları Türkçe gelsin
  // Yerel önbellek: internet yokken de okunur, yazılanlar bağlantı gelince gönderilir.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  onAuthStateChanged(auth, onUserChanged);
}

window.sharedIdeas = {
  configured,
  get uid() { return auth && auth.currentUser ? auth.currentUser.uid : null; },
  // hesap
  register, login, logout, resetPassword, resendVerification, checkVerified,
  // alanlar
  connect, disconnect, createRoom, acceptInvite, declineInvite, leaveRoom, removeMember, invite, loadMyRooms,
  // içerik
  add, update, remove, restore, addNote, removeNote, restoreNote, setFocusStats,
  subscribe(fn) {
    listeners.add(fn);
    fn(current);
    return () => listeners.delete(fn);
  },
};
