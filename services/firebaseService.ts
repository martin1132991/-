
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, push, remove, onChildAdded, off, child, get } from "firebase/database";
import { GameState, NetworkMessage } from '../types';

// Configuration provided by user
const firebaseConfig = {
  apiKey: "AIzaSyAAV8Kk26femWNclxOmD-oxsPPT0sR-H94",
  authDomain: "cowcowking-30ca6.firebaseapp.com",
  databaseURL: "https://cowcowking-30ca6-default-rtdb.firebaseio.com",
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
    try {
      // Generate a random 4-digit room ID
      const roomId = Math.floor(1000 + Math.random() * 9000).toString();
      this.roomId = roomId;

      console.log(`Attempting to create room: ${roomId} at ${firebaseConfig.databaseURL}`);

      // Clear any existing data for this room just in case
      await set(ref(db, `rooms/${roomId}`), null);
      
      // Set initial existence
      await set(ref(db, `rooms/${roomId}/created`), Date.now());
      
      console.log(`Room ${roomId} created successfully.`);
      return roomId;
    } catch (error) {
      console.error("Firebase Create Room Error:", error);
      throw error;
    }
  }

  // Update the global game state (Host only)
  updateGameState(roomId: string, state: GameState) {
    set(ref(db, `rooms/${roomId}/gameState`), state).catch(e => console.error("Update State Error:", e));
  }

  // Listen for actions from clients (Host only)
  // RETURNS: Unsubscribe function
  subscribeToActions(roomId: string, callback: (msg: NetworkMessage) => void): () => void {
    const actionsRef = ref(db, `rooms/${roomId}/actions`);
    
    const listener = onChildAdded(actionsRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        callback(val as NetworkMessage);
        // Remove the action after processing to keep the queue clean
        remove(snapshot.ref).catch(e => console.error("Remove Action Error:", e)); 
      }
    });

    // Return cleanup function
    return () => off(actionsRef, 'child_added', listener);
  }

  // --- CLIENT METHODS ---

  // Check if room exists
  async joinRoom(roomId: string): Promise<boolean> {
    try {
      const roomRef = ref(db, `rooms/${roomId}`);
      const snapshot = await get(roomRef);
      if (snapshot.exists()) {
        this.roomId = roomId;
        return true;
      }
      return false;
    } catch (error) {
      console.error("Join Room Error:", error);
      throw error;
    }
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
    push(actionsRef, action).catch(e => console.error("Send Action Error:", e));
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
