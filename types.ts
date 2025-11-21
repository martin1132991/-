
export interface CardData {
  id: number; // The number on the card (1-104)
  bullHeads: number; // The penalty points
}

export enum PlayerType {
  HUMAN = 'HUMAN',
  BOT = 'BOT'
}

export interface RoundResult {
  score: number;
  heads: number;
}

export interface Player {
  id: string;
  name: string;
  type: PlayerType;
  hand: CardData[];
  collectedCards: CardData[]; // Cards taken (bull heads)
  scoreHistory: RoundResult[]; // Score and heads per round
  totalScore: number;
  selectedCard: CardData | null; // Card chosen for the current turn
  isConnected?: boolean; // For multiplayer status
  isReady?: boolean; // Optional ready state for toggle feature
}

export interface GameRow {
  cards: CardData[];
}

export enum GamePhase {
  LOBBY = 'LOBBY',
  DEALING = 'DEALING',
  PLAYER_CHOICE = 'PLAYER_CHOICE', // Waiting for players to pick a card
  REVEAL = 'REVEAL', // Showing selected cards
  RESOLVING = 'RESOLVING', // Placing cards one by one
  CHOOSING_ROW = 'CHOOSING_ROW', // User needs to pick a row to take
  ROUND_VOTING = 'ROUND_VOTING', // Voting to continue
  ROUND_END = 'ROUND_END',
  GAME_END = 'GAME_END'
}

export interface GameConfig {
  maxRounds: number;
  totalPlayers: number;
}

// --- Networking Types ---

export enum NetworkMode {
  LOCAL = 'LOCAL',   // Hotseat / Pass & Play
  HOST = 'HOST',     // Firebase Host
  CLIENT = 'CLIENT'  // Firebase Client
}

export interface GameState {
  players: Player[];
  rows: GameRow[];
  phase: GamePhase;
  currentRound: number;
  activePlayerId: string | null;
  turnCards: {playerId: string, card: CardData}[];
  resolvingIndex: number;
  userMessage: string;
  votes: Record<string, boolean>;
  takingRowIndex: number; // Index of the row currently being captured (animation state)
}

export type NetworkMessage = 
  | { type: 'STATE_UPDATE'; payload: GameState }
  | { type: 'ACTION_SELECT_CARD'; payload: { card: CardData; playerId: string } }
  | { type: 'ACTION_SELECT_ROW'; payload: { rowIndex: number; playerId: string } }
  | { type: 'ACTION_VOTE_NEXT_ROUND'; payload: { vote: boolean; playerId: string } }
  | { type: 'ACTION_TOGGLE_READY'; payload: { isReady: boolean; playerId: string } }
  | { type: 'PLAYER_JOINED'; payload: { id: string; name: string } };
