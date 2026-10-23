// 로그인과 클라우드 동기화. 로그인하면 users/{uid}/items 에 일정이 저장되고 모든 기기에서 같은 일정이 보입니다.
import { FIREBASE_CONFIG } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const $ = id => document.getElementById(id);
const accountBtn = $("account");

const AUTH_ERRORS = {
  "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
  "auth/missing-password": "비밀번호를 입력해 주세요.",
  "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
  "auth/email-already-in-use": "이미 가입된 이메일입니다. 로그인으로 바꿔 시도해 주세요.",
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않습니다.",
  "auth/user-not-found": "가입되지 않은 이메일입니다.",
  "auth/wrong-password": "비밀번호가 맞지 않습니다.",
  "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "auth/popup-closed-by-user": "로그인 창이 닫혔습니다.",
  "auth/popup-blocked": "팝업이 차단되었습니다. 이메일로 로그인해 주세요.",
  "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
  "auth/unauthorized-domain": "이 주소는 Firebase에 허용되지 않았습니다. 승인된 도메인에 추가해 주세요."
};
const authMsg = e => AUTH_ERRORS[e?.code] || "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";

if (FIREBASE_CONFIG?.apiKey) start().catch(() => { accountBtn.hidden = true; });

async function start(){
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) });
  accountBtn.hidden = false;

  let unsub = null;

  /* ----- login dialog ----- */
  const ov = $("auth-overlay"), form = $("auth-form"), err = $("auth-error");
  let mode = "login";
  const setMode = m => {
    mode = m;
    $("auth-title").textContent = m === "login" ? "로그인" : "회원가입";
    $("auth-submit").textContent = m === "login" ? "로그인" : "가입하기";
    $("auth-switch").textContent = m === "login" ? "처음이세요? 회원가입" : "이미 계정이 있어요. 로그인";
    $("auth-pass").autocomplete = m === "login" ? "current-password" : "new-password";
    err.textContent = "";
  };
  const open = () => { setMode("login"); ov.hidden = false; setTimeout(() => $("auth-email").focus(), 0); };
  const close = () => { ov.hidden = true; err.textContent = ""; };
  $("auth-switch").onclick = () => setMode(mode === "login" ? "signup" : "login");
  $("auth-cancel").onclick = close;
  ov.addEventListener("mousedown", e => { if (e.target === ov) close(); });
  form.addEventListener("submit", async e => {
    e.preventDefault(); err.textContent = "";
    const email = $("auth-email").value.trim(), pass = $("auth-pass").value;
    try {
      if (mode === "login") await A.signInWithEmailAndPassword(auth, email, pass);
      else await A.createUserWithEmailAndPassword(auth, email, pass);
      close();
    } catch(x){ err.textContent = authMsg(x); }
  });
  $("auth-google").onclick = async () => {
    err.textContent = "";
    try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); close(); }
    catch(x){ err.textContent = authMsg(x); }
  };
  $("auth-reset").onclick = async () => {
    const email = $("auth-email").value.trim();
    if (!email) { err.textContent = "비밀번호를 재설정할 이메일을 먼저 입력해 주세요."; return; }
    try { await A.sendPasswordResetEmail(auth, email); err.textContent = "재설정 메일을 보냈습니다. 메일함을 확인해 주세요."; }
    catch(x){ err.textContent = authMsg(x); }
  };
  accountBtn.onclick = () => { if (auth.currentUser) $("account-menu").hidden = !$("account-menu").hidden; else open(); };
  $("logout").onclick = async () => { $("account-menu").hidden = true; await A.signOut(auth); toast("로그아웃했습니다."); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !ov.hidden) close(); });

  /* ----- sync ----- */
  A.onAuthStateChanged(auth, async user => {
    if (unsub) { unsub(); unsub = null; }
    window.cloudUser = user || null;
    $("account-menu").hidden = true;
    if (!user) {
      accountBtn.textContent = "로그인";
      items = new Map(); store = null; useLocal(); render();
      return;
    }
    accountBtn.textContent = (user.displayName || user.email || "내 계정").split("@")[0];
    $("account-email").textContent = user.email || "";
    const col = F.collection(db, "users", user.uid, "items");
    const ref = id => F.doc(db, "users", user.uid, "items", id);
    const fail = () => toast("클라우드에 저장하지 못했습니다. 인터넷 연결을 확인해 주세요.");

    // 이 기기에만 있던 일정은 처음 로그인할 때 계정으로 옮깁니다.
    let local = [];
    try { local = JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch(e){}
    if (local.length) {
      try {
        const batch = F.writeBatch(db);
        local.slice(0, 450).forEach(i => batch.set(ref(i.id), i));
        await batch.commit();
        localStorage.removeItem(LS_KEY);
        toast(`이 기기의 일정 ${local.length}개를 계정으로 옮겼습니다.`);
      } catch(e){ fail(); }
    }

    const cloud = {
      mode: "cloud",
      save(){},
      async put(i){ items.set(i.id, i); render(); F.setDoc(ref(i.id), i).catch(fail); },
      async del(id){ items.delete(id); render(); F.deleteDoc(ref(id)).catch(fail); }
    };
    items = new Map(); store = cloud; render();
    unsub = F.onSnapshot(col, snap => {
      const next = new Map();
      snap.forEach(d => { const v = d.data(); if (v && typeof v.title === "string") next.set(d.id, { ...v, id: d.id }); });
      items = next; render();
    }, () => toast("일정을 불러오지 못했습니다. 다시 로그인해 주세요."));
  });
}
