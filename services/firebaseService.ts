
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, push, remove, onChildAdded, off, child, get } from "firebase/database";
import { GameState, NetworkMessage } from '../types';

// Configuration provided by user
const firebaseConfig = {
  apiKey: "AIzaSyAAV8Kk26femWNclxOmD-oxsPPT0sR-H94",
  authDomain: "cowcowking-30ca6.firebaseapp.com",
  projectId: "cowcowking-30ca6",
  storageBucket: "cowcowking-30ca6.firebasestorage.app",
  messagingSenderId: "814490629694",
  appId: "1:814490629694:web:2ae0a4d4f5d8cd6245036f",
  measurementId: "G-Q4T0Z3YDRT"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export class FirebaseService {
  private roomId: string | null = null;

  // --- HOST METHODS ---

  // Create a room with a random 4-digit ID
  async createRoom(): Promise<string> {
    // Generate a random 4-digit room ID
    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
    this.roomId = roomId;

    // Clear any existing data for this room just in case
    await set(ref(db, `rooms/${roomId}`), null);
    
    // Set initial existence
    await set(ref(db, `rooms/${roomId}/created`), Date.now());

    return roomId;
  }

  // Update the global game state (Host only)
  updateGameState(roomId: string, state: GameState) {
    set(ref(db, `rooms/${roomId}/gameState`), state);
  }

  // Listen for actions from clients (Host only)
  subscribeToActions(roomId: string, callback: (msg: NetworkMessage) => void) {
    const actionsRef = ref(db, `rooms/${roomId}/actions`);
    
    onChildAdded(actionsRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        callback(val as NetworkMessage);
        // Remove the action after processing to keep the queue clean
        remove(snapshot.ref); 
      }
    });
  }

  // --- CLIENT METHODS ---

  // Check if room exists
  async joinRoom(roomId: string): Promise<boolean> {
    const roomRef = ref(db, `rooms/${roomId}`);
    const snapshot = await get(roomRef);
    if (snapshot.exists()) {
      this.roomId = roomId;
      return true;
    }
    return false;
  }

  // Listen for game state updates (Client only)
  subscribeToGameState(roomId: string, callback: (state: GameState) => void) {
    const stateRef = ref(db, `rooms/${roomId}/gameState`);
    onValue(stateRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        callback(val as GameState);
      }
    });
  }

  // Send an action to the host (Client only)
  sendAction(roomId: string, action: NetworkMessage) {
    const actionsRef = ref(db, `rooms/${roomId}/actions`);
    push(actionsRef, action);
  }

  // --- CLEANUP ---
  cleanup() {
    if (this.roomId) {
      const roomRef = ref(db, `rooms/${this.roomId}`);
      off(roomRef);
      const actionsRef = ref(db, `rooms/${this.roomId}/actions`);
      off(actionsRef);
      const stateRef = ref(db, `rooms/${this.roomId}/gameState`);
      off(stateRef);
    }
  }
}

export const firebaseService = new FirebaseService();
