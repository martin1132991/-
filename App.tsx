import React, { useState, useEffect, useRef } from 'react';
import { 
  CardData, 
  GamePhase, 
  GameRow, 
  Player, 
  PlayerType,
  GameConfig,
  NetworkMode,
  GameState,
  NetworkMessage
} from './types';
import { 
  generateDeck, 
  shuffleDeck, 
  findTargetRowIndex, 
  sumBullHeads,
  calculateRoundScore
} from './services/gameLogic';
import { getBotDecision, getBotRowChoice } from './services/aiService';
import { peerService } from './services/peerService';
import Card from './components/Card';
import GameBoard from './components/GameBoard';
import ScoreBoard from './components/ScoreBoard';
import { Trophy, Users, Play, RotateCw, Skull, Eye, EyeOff, BarChart3, AlertTriangle, Bot, Wifi, Copy, Smartphone } from 'lucide-react';

const INITIAL_CONFIG: GameConfig = {
  maxRounds: 10,
  totalPlayers: 4
};

export default function App() {
  // --- Configuration ---
  const [config, setConfig] = useState<GameConfig>(INITIAL_CONFIG);
  
  // --- Network State ---
  const [networkMode, setNetworkMode] = useState<NetworkMode>(NetworkMode.LOCAL);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [hostIdInput, setHostIdInput] = useState('');
  const [myPlayerId, setMyPlayerId] = useState<string>('human-0'); // Default for local
  const [connectedPlayers, setConnectedPlayers] = useState<{id: string, name: string}[]>([]); // For Lobby
  const [playerNameInput, setPlayerNameInput] = useState('');

  // --- Game State ---
  const [phase, setPhase] = useState<GamePhase>(GamePhase.LOBBY);
  const [currentRound, setCurrentRound] = useState(1);
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<GameRow[]>([]);
  
  // Logic State
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [turnCards, setTurnCards] = useState<{playerId: string, card: CardData}[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState(-1);
  const [userMessage, setUserMessage] = useState<string>("");
  
  // UI State
  const [isScoreBoardOpen, setIsScoreBoardOpen] = useState(false);
  const processingRef = useRef(false);

  // --- Networking Setup (Centralized) ---

  // This effect handles ALL incoming network messages
  useEffect(() => {
    peerService.onMessage = (msg: NetworkMessage) => {
      // console.log('App processing message:', msg);

      // --- CLIENT LOGIC ---
      if (networkMode === NetworkMode.CLIENT) {
        switch (msg.type) {
          case 'WELCOME':
            // Host assigned us an ID/State (Not fully used in this simple flow yet, but good practice)
            setMyPlayerId(msg.payload.playerId);
            syncState(msg.payload.gameState);
            break;
          case 'STATE_UPDATE':
            syncState(msg.payload);
            break;
        }
      } 
      
      // --- HOST LOGIC ---
      else if (networkMode === NetworkMode.HOST) {
        switch (msg.type) {
          case 'PLAYER_JOINED':
            // Prevent duplicates
            setConnectedPlayers(prev => {
              if (prev.some(p => p.name === msg.payload.name)) return prev;
              return [...prev, msg.payload];
            });
            setUserMessage(`${msg.payload.name} joined!`);
            break;
            
          case 'ACTION_SELECT_CARD':
            // Host receives a card selection from a client
            // We need to find WHICH player held this card to identify them
            const ownerId = findOwnerOfCard(msg.payload.card);
            if (ownerId) {
              handlePlayerAction(msg.payload.card, ownerId);
            }
            break;
            
          case 'ACTION_SELECT_ROW':
            // Host receives a row selection from a client
            // We check if it's the current resolving player's turn
            const turn = turnCards[resolvingIndex];
            if (turn) {
               // We assume the sender is valid for now (simple demo)
               executeRowTake(turn, msg.payload.rowIndex);
            }
            break;
        }
      }
    };
  }, [networkMode, players, rows, turnCards, resolvingIndex]); // Re-bind when state changes so Host has latest data


  // Syncs local state with received Network State (Client Mode)
  const syncState = (state: GameState) => {
    setPlayers(state.players);
    setRows(state.rows);
    setPhase(state.phase);
    setCurrentRound(state.currentRound);
    setActivePlayerId(state.activePlayerId);
    setTurnCards(state.turnCards);
    setResolvingIndex(state.resolvingIndex);
    setUserMessage(state.userMessage);
  };

  // --- Host Logic: Broadcasting ---
  // Whenever significant state changes, broadcast it if we are Host.
  useEffect(() => {
    if (networkMode === NetworkMode.HOST && phase !== GamePhase.LOBBY) {
      const currentState: GameState = {
        players,
        rows,
        phase,
        currentRound,
        activePlayerId,
        turnCards,
        resolvingIndex,
        userMessage
      };
      peerService.broadcast({ type: 'STATE_UPDATE', payload: currentState });
    }
  }, [players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, networkMode]);

  // --- Helper: Find card owner ---
  const findOwnerOfCard = (card: CardData): string | undefined => {
    // Look through all players' hands
    for (const p of players) {
      if (p.hand.some(c => c.id === card.id)) {
        return p.id;
      }
    }
    return undefined;
  };


  // --- Lobby Actions ---

  const initHost = async () => {
    try {
      const id = await peerService.init(); // Will return random ID
      setMyPeerId(id);
      setNetworkMode(NetworkMode.HOST);
      setPlayerNameInput("Host");
      setConnectedPlayers([{ id: 'human-0', name: 'Host' }]);
    } catch (e) {
      alert("Failed to initialize PeerJS: " + e);
    }
  };

  const joinGame = async () => {
    if (!hostIdInput) return alert("Enter Room ID");
    if (!playerNameInput) return alert("Enter Name");

    try {
      // Re-init peer for client if needed
      await peerService.init(); 
      setNetworkMode(NetworkMode.CLIENT);
      setUserMessage("Connecting to host...");
      
      await peerService.connectToHost(hostIdInput);
      
      setUserMessage("Connected! Verifying...");
      
      // CRITICAL STABILITY FIX:
      // Wait 1 second for the WebRTC data channel to stabilize before sending data.
      // Sending immediately can sometimes result in the message being lost if the channel isn't fully ready.
      setTimeout(() => {
        peerService.sendToHost({ 
          type: 'PLAYER_JOINED', 
          payload: { id: 'temp', name: playerNameInput } 
        });
        setUserMessage("Connected! Waiting for host to start...");
      }, 1000);

    } catch (e: any) {
      console.error(e);
      alert("Connection Failed: " + (e.message || e));
      setNetworkMode(NetworkMode.LOCAL);
      setUserMessage("");
    }
  };

  // --- Host Logic: Game Management ---

  const startHostGame = () => {
    if (networkMode !== NetworkMode.HOST) return;

    const deck = shuffleDeck(generateDeck());
    const newPlayers: Player[] = [];

    // 1. Add Connected Humans
    connectedPlayers.forEach((p, index) => {
      newPlayers.push({
        id: `human-${index}`, // IDs are human-0, human-1...
        name: p.name,
        type: PlayerType.HUMAN,
        hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
        collectedCards: [],
        scoreHistory: [],
        totalScore: 0,
        selectedCard: null,
        isConnected: true
      });
    });

    // 2. Fill remaining slots with Bots
    const currentCount = newPlayers.length;
    const needed = Math.max(4, config.totalPlayers) - currentCount;
    
    for (let i = 0; i < needed; i++) {
      newPlayers.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        type: PlayerType.BOT,
        hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
        collectedCards: [],
        scoreHistory: [],
        totalScore: 0,
        selectedCard: null
      });
    }

    // Rows
    const newRows: GameRow[] = Array.from({ length: 4 }).map(() => ({
      cards: [deck.shift()!]
    }));

    setPlayers(newPlayers);
    setRows(newRows);
    setCurrentRound(1);
    setPhase(GamePhase.PLAYER_CHOICE);
    
    // Host is always human-0
    setMyPlayerId('human-0'); 
  };
  
  // Handle name-based ID claiming for clients
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT && phase !== GamePhase.LOBBY && myPlayerId === 'human-0') {
       // Try to find my ID based on name
       const me = players.find(p => p.name === playerNameInput);
       if (me) {
         setMyPlayerId(me.id);
         // console.log("Matched my player ID to:", me.id);
       }
    }
  }, [players, networkMode, phase, playerNameInput, myPlayerId]);


  // --- Game Logic (Host Only) ---

  // Check if everyone has selected
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;
    if (phase !== GamePhase.PLAYER_CHOICE) return;

    const allHumanSelected = players
      .filter(p => p.type === PlayerType.HUMAN)
      .every(p => p.selectedCard !== null);

    // Trigger bots if they haven't selected yet
    const bots = players.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);
    if (bots.length > 0 && !processingRef.current) {
      triggerBotTurns(players);
    }

    if (allHumanSelected && bots.length === 0) {
      // Everyone selected!
      startRevealPhase(players);
    }
  }, [players, phase, networkMode]);

  const triggerBotTurns = async (currentPlayers: Player[]) => {
    if (processingRef.current) return;
    processingRef.current = true;
    
    // Only update Bots
    const updatedPlayers = [...currentPlayers];
    const bots = updatedPlayers.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);

    for (const bot of bots) {
      const chosen = await getBotDecision(bot, rows, []);
      bot.selectedCard = chosen;
    }
    
    setPlayers(updatedPlayers);
    processingRef.current = false;
  };

  const handlePlayerAction = (card: CardData, playerId: string) => {
    setPlayers(prev => prev.map(p => 
      p.id === playerId ? { ...p, selectedCard: card } : p
    ));
  };

  // --- Phase Logic (Host Only) ---

  const startNewRound = (playersSnapshot?: Player[]) => {
    if (currentRound >= config.maxRounds) {
      setPhase(GamePhase.GAME_END);
      return;
    }

    const deck = shuffleDeck(generateDeck());
    const sourcePlayers = playersSnapshot || players;

    const updatedPlayers = sourcePlayers.map(p => ({
      ...p,
      hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
      collectedCards: [],
      selectedCard: null
    }));

    const newRows: GameRow[] = Array.from({ length: 4 }).map(() => ({
      cards: [deck.shift()!]
    }));

    setPlayers(updatedPlayers);
    setRows(newRows);
    setCurrentRound(prev => prev + 1);
    setTurnCards([]);
    setResolvingIndex(-1);
    setPhase(GamePhase.PLAYER_CHOICE);
  };

  const startRevealPhase = (currentPlayers: Player[]) => {
    setPhase(GamePhase.REVEAL);
    setUserMessage("Revealing cards...");

    const currentTurnCards = currentPlayers
      .map(p => ({ playerId: p.id, card: p.selectedCard! }))
      .sort((a, b) => a.card.id - b.card.id);
    
    setTurnCards(currentTurnCards);

    setPlayers(prev => prev.map(p => ({
      ...p,
      hand: p.hand.filter(c => c.id !== p.selectedCard?.id)
    })));

    setTimeout(() => {
      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(0);
    }, 2500);
  };

  // Resolution Loop (Host Only)
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return; // Clients wait for updates

    if (phase === GamePhase.RESOLVING && resolvingIndex >= 0 && resolvingIndex < turnCards.length) {
      const turn = turnCards[resolvingIndex];
      processCardPlacement(turn);
    } else if (phase === GamePhase.RESOLVING && resolvingIndex >= turnCards.length && turnCards.length > 0) {
      finishTurnSet();
    }
  }, [phase, resolvingIndex, turnCards, networkMode]); 

  const processCardPlacement = async (turn: { playerId: string, card: CardData }) => {
    const rowIndex = findTargetRowIndex(turn.card, rows);
    
    if (rowIndex === -1) {
      handleLowCardEvent(turn);
    } else {
      const targetRow = rows[rowIndex];
      if (targetRow.cards.length >= 5) {
        handleRowOverflow(turn, rowIndex);
      } else {
        placeCardInRow(turn, rowIndex);
      }
    }
  };

  const placeCardInRow = (turn: { playerId: string, card: CardData }, rowIndex: number) => {
    setTimeout(() => {
      setRows(prev => {
        const newRows = [...prev];
        newRows[rowIndex] = {
          ...newRows[rowIndex],
          cards: [...newRows[rowIndex].cards, turn.card]
        };
        return newRows;
      });
      setResolvingIndex(prev => prev + 1);
    }, 1000);
  };

  const handleRowOverflow = (turn: { playerId: string, card: CardData }, rowIndex: number) => {
    const playerName = players.find(p => p.id === turn.playerId)?.name;
    setUserMessage(`${playerName} takes Row #${rowIndex + 1}!`);
    setTimeout(() => {
      const rowCards = rows[rowIndex].cards;
      setPlayers(prev => prev.map(p => {
        if (p.id === turn.playerId) {
          return { ...p, collectedCards: [...p.collectedCards, ...rowCards] };
        }
        return p;
      }));

      setRows(prev => {
        const newRows = [...prev];
        newRows[rowIndex] = { cards: [turn.card] };
        return newRows;
      });

      setResolvingIndex(prev => prev + 1);
    }, 1500);
  };

  const handleLowCardEvent = async (turn: { playerId: string, card: CardData }) => {
    const player = players.find(p => p.id === turn.playerId);
    if (!player) return;

    if (player.type === PlayerType.HUMAN) {
      setPhase(GamePhase.CHOOSING_ROW);
      setUserMessage(`${player.name}, card too low! Choose a row to take.`);
      // Wait for network action or local click
    } else {
      const chosenRowIdx = await getBotRowChoice(player, rows);
      setUserMessage(`${player.name} (Low Card) takes Row #${chosenRowIdx + 1}`);
      executeRowTake(turn, chosenRowIdx);
    }
  };

  const executeRowTake = (turn: { playerId: string, card: CardData }, rowIndex: number) => {
     // Can be called by Host logic or Network Event
     setTimeout(() => {
      const rowCards = rows[rowIndex].cards;
      
      setPlayers(prev => prev.map(p => {
        if (p.id === turn.playerId) {
          return { ...p, collectedCards: [...p.collectedCards, ...rowCards] };
        }
        return p;
      }));

      setRows(prev => {
        const newRows = [...prev];
        newRows[rowIndex] = { cards: [turn.card] };
        return newRows;
      });

      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(prev => prev + 1);
     }, 1000);
  };

  const finishTurnSet = () => {
    setTurnCards([]);
    setResolvingIndex(-1);
    
    const nextPlayers = players.map(p => ({ ...p, selectedCard: null }));
    setPlayers(nextPlayers);

    if (nextPlayers[0].hand.length === 0) {
      calculateScoresAndNextRound();
    } else {
      setPhase(GamePhase.PLAYER_CHOICE);
    }
  };

  const calculateScoresAndNextRound = () => {
    const playersWithNewScores = players.map(p => {
      const roundScore = calculateRoundScore(p, players);
      const roundHeads = sumBullHeads(p.collectedCards);
      return {
        ...p,
        scoreHistory: [...p.scoreHistory, { score: roundScore, heads: roundHeads }],
        totalScore: p.totalScore + roundScore
      };
    });

    setPlayers(playersWithNewScores);

    if (currentRound >= config.maxRounds) {
      setPhase(GamePhase.GAME_END);
    } else {
      setUserMessage("Round Complete! Preparing next round...");
      setTimeout(() => startNewRound(playersWithNewScores), 4000);
    }
  };

  // --- View Actions (Client + Local) ---

  const onCardClick = (card: CardData) => {
    // If Client, send to Host
    if (networkMode === NetworkMode.CLIENT) {
      if (phase !== GamePhase.PLAYER_CHOICE) return;
      // Send to Host
      peerService.sendToHost({ type: 'ACTION_SELECT_CARD', payload: { card } });
      
      // Optimistic UI: Show selection on Client immediately for feedback
      handlePlayerAction(card, myPlayerId);
    } 
    // If Host/Local
    else {
      handlePlayerAction(card, myPlayerId);
    }
  };

  const onRowClick = (rowIndex: number) => {
    if (phase !== GamePhase.CHOOSING_ROW) return;
    
    // Am I the one who needs to choose?
    const turn = turnCards[resolvingIndex];
    if (turn?.playerId !== myPlayerId) return;

    if (networkMode === NetworkMode.CLIENT) {
      setUserMessage(`Taking Row #${rowIndex + 1}...`);
      peerService.sendToHost({ type: 'ACTION_SELECT_ROW', payload: { rowIndex } });
    } else {
      setUserMessage(`Taking Row #${rowIndex + 1}...`);
      executeRowTake(turn, rowIndex);
    }
  };

  // --- RENDERERS ---

  const myPlayer = players.find(p => p.id === myPlayerId);
  const resolvingPlayerName = resolvingIndex >= 0 && resolvingIndex < turnCards.length 
    ? players.find(p => p.id === turnCards[resolvingIndex].playerId)?.name 
    : null;

  if (phase === GamePhase.LOBBY) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-emerald-900/40 via-slate-900 to-slate-900 pointer-events-none"></div>
        
        <div className="text-center mb-10 z-10">
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-br from-emerald-400 to-teal-600 mb-2">
            COW KING
          </h1>
          <p className="text-slate-400 tracking-widest uppercase text-sm font-semibold">Multiplayer Edition</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl z-10">
          
          {/* CREATE GAME */}
          <div className="bg-slate-800/50 backdrop-blur-lg p-6 rounded-2xl border border-slate-700 shadow-xl flex flex-col">
             <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
               <Smartphone className="text-emerald-400" /> Create Game (Host)
             </h3>
             
             {!myPeerId ? (
               <button onClick={initHost} className="mt-auto py-3 bg-emerald-600 rounded-lg font-bold hover:bg-emerald-500 transition-colors">
                 Create Room
               </button>
             ) : (
               <div className="space-y-4">
                 <div className="bg-slate-900 p-4 rounded-lg border border-emerald-500/30">
                   <div className="text-xs text-slate-400 uppercase">Room ID</div>
                   <div className="text-2xl font-mono font-bold text-emerald-400 tracking-widest flex justify-between items-center">
                     {myPeerId}
                     <button onClick={() => navigator.clipboard.writeText(myPeerId)} className="p-2 hover:bg-slate-800 rounded"><Copy size={16}/></button>
                   </div>
                   <p className="text-xs text-slate-500 mt-2">Share this ID with your friends</p>
                 </div>

                 <div>
                   <div className="text-sm font-bold mb-2">Players Joined: {connectedPlayers.length}</div>
                   <div className="flex flex-wrap gap-2">
                     {connectedPlayers.map(p => (
                       <span key={p.id} className="px-3 py-1 bg-slate-700 rounded-full text-sm flex items-center gap-1">
                         <Users size={12}/> {p.name}
                       </span>
                     ))}
                   </div>
                 </div>
                 
                 <div className="pt-4 border-t border-slate-700">
                    <label className="text-xs text-slate-400 block mb-1">Total Slots (Others will be Bots)</label>
                    <div className="flex gap-2 mb-4">
                      {[4,5,6,7,8].map(n => (
                        <button key={n} onClick={() => setConfig(c => ({...c, totalPlayers: n}))} 
                          className={`flex-1 py-1 rounded border ${config.totalPlayers === n ? 'bg-emerald-600 border-emerald-400' : 'bg-slate-800 border-slate-700'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                    <button onClick={startHostGame} className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 rounded-lg font-bold">Start Match</button>
                 </div>
               </div>
             )}
          </div>

          {/* JOIN GAME */}
          <div className="bg-slate-800/50 backdrop-blur-lg p-6 rounded-2xl border border-slate-700 shadow-xl flex flex-col">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
               <Users className="text-blue-400" /> Join Game
            </h3>
            
            {networkMode !== NetworkMode.CLIENT ? (
               <div className="space-y-4 mt-auto">
                 <div>
                   <label className="block text-sm text-slate-400 mb-1">Your Name</label>
                   <input 
                     type="text" 
                     className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:border-blue-500 outline-none"
                     placeholder="Enter your nickname"
                     value={playerNameInput}
                     onChange={e => setPlayerNameInput(e.target.value)}
                   />
                 </div>
                 <div>
                   <label className="block text-sm text-slate-400 mb-1">Room ID</label>
                   <input 
                     type="text" 
                     className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white font-mono focus:border-blue-500 outline-none"
                     placeholder="Paste Room ID here"
                     value={hostIdInput}
                     onChange={e => setHostIdInput(e.target.value)}
                   />
                 </div>
                 <button onClick={joinGame} className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold transition-colors">
                   Join Room
                 </button>
               </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse">
                 <Wifi size={48} className="mb-4"/>
                 <p>Waiting for Host to start...</p>
              </div>
            )}
          </div>

        </div>
        
        <div className="mt-8 text-xs text-slate-500">
           Or play <button onClick={() => {setNetworkMode(NetworkMode.LOCAL); setPlayerNameInput("Player 1"); startHostGame(); }} className="text-slate-300 hover:underline">Offline Hotseat Mode</button>
        </div>
      </div>
    );
  }

  if (phase === GamePhase.GAME_END) {
    // Sort Descending
    const sortedPlayers = [...players].sort((a, b) => b.totalScore - a.totalScore);
    const winner = sortedPlayers[0];

    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-4">
         <div className="bg-slate-800 p-8 rounded-3xl shadow-2xl border border-slate-700 max-w-2xl w-full">
           <div className="text-center mb-8">
             <div className="inline-block p-4 rounded-full bg-yellow-500/20 mb-4">
               <Trophy size={64} className="text-yellow-400" />
             </div>
             <h1 className="text-4xl font-bold mb-2">Match Complete!</h1>
             <p className="text-2xl text-emerald-400 font-semibold">Winner: {winner.name}</p>
             <div className="mt-4 flex justify-center gap-4">
                <button onClick={() => window.location.reload()} className="px-6 py-2 bg-blue-600 rounded-lg">Back to Lobby</button>
             </div>
           </div>
           {/* Simple List */}
           <div className="space-y-2">
              {sortedPlayers.map((p,i) => (
                 <div key={p.id} className="flex justify-between p-3 bg-slate-700 rounded">
                    <span>#{i+1} {p.name}</span>
                    <span className="font-mono">{p.totalScore}</span>
                 </div>
              ))}
           </div>
         </div>
      </div>
    );
  }

  // --- MAIN GAME UI ---

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col overflow-hidden">
      <ScoreBoard players={players} currentRound={currentRound} isOpen={isScoreBoardOpen} onClose={() => setIsScoreBoardOpen(false)} />

      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex justify-between items-center shadow-lg z-20">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-black text-emerald-400 leading-none">COW KING</h1>
            <span className="text-[10px] text-slate-400 font-bold tracking-wider flex items-center gap-1">
               {networkMode === NetworkMode.HOST ? 'HOST' : 'CLIENT'} {networkMode === NetworkMode.LOCAL ? '(OFFLINE)' : ''}
            </span>
          </div>
          <div className="bg-slate-700 px-3 py-1 rounded text-xs text-slate-300 font-mono">
            R{currentRound}/{config.maxRounds}
          </div>
        </div>
        
        {/* Message Bar (Always visible now) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
           <div className="bg-black/40 px-4 py-1 rounded-full text-yellow-400 font-bold text-sm animate-pulse border border-yellow-500/30">
            {userMessage}
          </div>
        </div>

        <button onClick={() => setIsScoreBoardOpen(true)} className="flex items-center gap-2 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 px-3 py-2 rounded-lg border border-emerald-800 text-sm font-bold">
          <BarChart3 size={18} />
        </button>
      </header>
      
      {/* Mobile Msg */}
      <div className="md:hidden bg-slate-800 py-1 text-center text-yellow-400 text-xs font-bold border-b border-slate-700">{userMessage}</div>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Opponents Bar */}
        <div className="h-32 w-full flex justify-start sm:justify-center items-start gap-2 p-2 overflow-x-auto no-scrollbar">
          {players.filter(p => p.id !== myPlayerId).map(p => (
            <div key={p.id} className={`flex flex-col items-center flex-shrink-0 transition-opacity ${p.selectedCard ? 'opacity-100' : 'opacity-70'}`}>
              <div className={`w-12 h-16 rounded bg-slate-700 border-2 ${p.selectedCard && phase === GamePhase.PLAYER_CHOICE ? 'border-green-400 bg-green-900/30' : 'border-slate-600'} flex items-center justify-center relative`}>
                {p.selectedCard && phase !== GamePhase.PLAYER_CHOICE ? (
                   <Card id={p.selectedCard.id} bullHeads={p.selectedCard.bullHeads} small />
                ) : (
                   <span className="text-xs font-mono text-slate-400">{p.hand.length}</span>
                )}
                {p.selectedCard && phase === GamePhase.PLAYER_CHOICE && <div className="absolute inset-0 flex items-center justify-center text-green-400"><Users size={16}/></div>}
              </div>
              <span className="text-[10px] mt-1 text-slate-400 truncate w-14 text-center">{p.name}</span>
            </div>
          ))}
        </div>

        {/* Game Board */}
        <div className="flex-1 flex items-center justify-center p-2 overflow-y-auto">
           <GameBoard rows={rows} phase={phase} onSelectRow={onRowClick} />
        </div>

        {/* My Hand */}
        <div className="bg-slate-800 border-t border-slate-700 p-4">
          {myPlayer ? (
            <div className="max-w-5xl mx-auto">
               <div className="flex justify-between items-center mb-2">
                  <span className="text-white font-bold">Your Hand ({myPlayer.name})</span>
                  {myPlayer.selectedCard && phase === GamePhase.PLAYER_CHOICE && <span className="text-green-400 text-xs font-bold">Card Selected</span>}
               </div>
               <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                 {myPlayer.hand.map(card => (
                   <div key={card.id} className="flex-shrink-0 transition-transform hover:-translate-y-2">
                      <Card 
                        id={card.id} 
                        bullHeads={card.bullHeads} 
                        onClick={() => onCardClick(card)}
                        selected={myPlayer.selectedCard?.id === card.id}
                        disabled={phase !== GamePhase.PLAYER_CHOICE || myPlayer.selectedCard !== null}
                      />
                   </div>
                 ))}
               </div>
            </div>
          ) : (
            <div className="text-center text-slate-500">Spectating or Loading...</div>
          )}
        </div>

      </main>

      {/* Overlays */}
      {phase === GamePhase.RESOLVING && resolvingIndex >= 0 && resolvingIndex < turnCards.length && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none">
           <div className="bg-black/80 text-white px-6 py-3 rounded-xl text-xl font-bold border border-white/10 backdrop-blur flex items-center gap-4">
             <span className="text-emerald-400 text-3xl">#{turnCards[resolvingIndex].card.id}</span>
             <span>{resolvingPlayerName}</span>
           </div>
        </div>
      )}
      
      {phase === GamePhase.CHOOSING_ROW && (
         <div className="absolute inset-x-0 top-20 z-50 flex justify-center pointer-events-none">
            <div className="bg-yellow-500/90 text-yellow-900 px-4 py-2 rounded-full font-bold shadow-xl animate-bounce flex items-center gap-2">
               <AlertTriangle size={20} />
               <span>{resolvingPlayerName} must choose a row!</span>
            </div>
         </div>
      )}
    </div>
  );
}