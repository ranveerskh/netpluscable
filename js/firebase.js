import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, collectionGroup, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { showErr } from "./utils.js";

const firebaseConfig = {
  apiKey: "AIzaSyBOEuLTwXHlgwCeUJk-8zHLjtsljr-5CFM",
  authDomain: "netplustv-90b29.firebaseapp.com",
  projectId: "netplustv-90b29",
  storageBucket: "netplustv-90b29.firebasestorage.app",
  messagingSenderId: "639722274355",
  appId: "1:639722274355:web:ebe34fdf093f8191da2d46"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp, collectionGroup, writeBatch, getDocs
};

export async function safeGetDocs(qry, label){ try{ return await getDocs(qry); } catch(e){ showErr(label, e); throw e; } }
export async function safeAddDoc(ref, data, label){ try{ return await addDoc(ref, data); } catch(e){ showErr(label, e); throw e; } }
export async function safeSetDoc(ref, data, opts, label){ try{ return await setDoc(ref, data, opts); } catch(e){ showErr(label, e); throw e; } }
export async function safeUpdateDoc(ref, data, label){ try{ return await updateDoc(ref, data); } catch(e){ showErr(label, e); throw e; } }
export async function safeDeleteDoc(ref, label){ try{ return await deleteDoc(ref); } catch(e){ showErr(label, e); throw e; } }
