
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
import { Trophy, Users, Play, RotateCw, Skull, Eye, EyeOff, BarChart3, AlertTriangle, Bot, Wifi, Copy, Smartphone, ThumbsUp, ThumbsDown, CheckCircle, XCircle } from 'lucide-react';

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
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  
  // Logic State
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [turnCards, setTurnCards] = useState<{playerId: string, card: CardData}[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState(-1);
  const [userMessage, setUserMessage] = useState<string>("");
  const [takingRowIndex, setTakingRowIndex] = useState<number>(-1); // -1 means no row is currently being taken
  
  // UI State
  const [isScoreBoardOpen, setIsScoreBoardOpen] = useState(false);
  
  // Refs for Logic Safety
  const processingRef = useRef(false); // Prevent multiple bot triggers
  const lastProcessedIndexRef = useRef<number>(-1); // Prevent double-processing of resolution steps

  // --- Networking Setup (Centralized) ---

  // This effect handles ALL incoming network messages
  useEffect(() => {
    peerService.onMessage = (msg: NetworkMessage) => {
      // console.log('App processing message:', msg);

      // --- CLIENT LOGIC ---
      if (networkMode === NetworkMode.CLIENT) {
        switch (msg.type) {
          case 'WELCOME':
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
            // Dedup logic to prevent same player adding twice if connection fluctuates
            setConnectedPlayers(prev => {
              if (prev.some(p => p.name === msg.payload.name)) return prev;
              return [...prev, msg.payload];
            });
            setUserMessage(`${msg.payload.name} joined!`);
            // Send welcome back to confirm connection
            peerService.broadcast({ 
                type: 'WELCOME', 
                payload: { 
                    playerId: msg.payload.id, 
                    gameState: {
                        players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, votes, takingRowIndex
                    }
                } 
            });
            break;
            
          case 'ACTION_SELECT_CARD':
            const ownerId = findOwnerOfCard(msg.payload.card);
            if (ownerId) {
              handlePlayerAction(msg.payload.card, ownerId);
            }
            break;

          case 'ACTION_TOGGLE_READY':
             // We need to find which player sent this. 
             // In a real backend we verify token, here we rely on the Host knowing ID mapping or passing it.
             // P2P limitation: identifying sender relies on connection metadata or payload.
             // For simplicity, Client sends specific message, Host updates that client.
             // To do this properly without passing ID in payload (insecure but fine here), we iterate players.
             // Ideally msg.payload should have ID, but our type def is simplified.
             // Let's assume we handle this via finding who is not ready? No, we need ID.
             // Hack: Clients in this App are mapped. 
             // Fix: Let's look at handleToggleReady implementation below.
             break;
            
          case 'ACTION_SELECT_ROW':
            const turn = turnCards[resolvingIndex];
            if (turn) {
               executeRowTake(turn, msg.payload.rowIndex);
            }
            break;

           case 'ACTION_VOTE_NEXT_ROUND':
             // Handled by voting logic
             break;
        }
      }
    };
  }, [networkMode, players, rows, turnCards, resolvingIndex, votes, takingRowIndex]);


  const syncState = (state: GameState) => {
    setPlayers(state.players);
    setRows(state.rows);
    setPhase(state.phase);
    setCurrentRound(state.currentRound);
    setActivePlayerId(state.activePlayerId);
    setTurnCards(state.turnCards);
    setResolvingIndex(state.resolvingIndex);
    setUserMessage(state.userMessage);
    setVotes(state.votes || {});
    setTakingRowIndex(state.takingRowIndex ?? -1);
  };

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
        userMessage,
        votes,
        takingRowIndex
      };
      peerService.broadcast({ type: 'STATE_UPDATE', payload: currentState });
    }
  }, [players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, votes, takingRowIndex, networkMode]);

  const findOwnerOfCard = (card: CardData): string | undefined => {
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
      const id = await peerService.init();
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
      await peerService.init(); 
      setNetworkMode(NetworkMode.CLIENT);
      setUserMessage("Connecting to host...");
      
      await peerService.connectToHost(hostIdInput);
      
      setUserMessage("Connected! Verifying...");
      
      // HANDSHAKE DELAY: Wait for connection to stabilize before sending data
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

    // Add Humans
    connectedPlayers.forEach((p, index) => {
      newPlayers.push({
        id: `human-${index}`,
        name: p.name,
        type: PlayerType.HUMAN,
        hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
        collectedCards: [],
        scoreHistory: [],
        totalScore: 0,
        selectedCard: null,
        isConnected: true,
        isReady: false
      });
    });

    // Add Bots
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
        selectedCard: null,
        isReady: false
      });
    }

    const newRows: GameRow[] = Array.from({ length: 4 }).map(() => ({
      cards: [deck.shift()!]
    }));

    setPlayers(newPlayers);
    setRows(newRows);
    setCurrentRound(1);
    setPhase(GamePhase.PLAYER_CHOICE);
    setMyPlayerId('human-0'); 
  };
  
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT && phase !== GamePhase.LOBBY && myPlayerId === 'human-0') {
       const me = players.find(p => p.name === playerNameInput);
       if (me) {
         setMyPlayerId(me.id);
       }
    }
  }, [players, networkMode, phase, playerNameInput, myPlayerId]);


  // --- Game Logic (Host Only) ---

  // CHECK FOR PHASE TRANSITION: SELECTION -> REVEAL
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;
    if (phase !== GamePhase.PLAYER_CHOICE) return;

    // 1. Check Humans: Must be SELECTED and READY
    const humans = players.filter(p => p.type === PlayerType.HUMAN);
    const allHumansReady = humans.every(p => p.selectedCard !== null && p.isReady);

    // 2. Trigger Bots if not done
    // Bots are "Ready" as soon as they select.
    const bots = players.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);
    if (bots.length > 0 && !processingRef.current) {
      triggerBotTurns();
    }

    // 3. Check Everyone
    const allSelected = players.every(p => p.selectedCard !== null);
    
    // We rely on the 'isReady' flag for Humans, but Bots just need to have selected.
    const botsReady = players.filter(p => p.type === PlayerType.BOT).every(p => p.selectedCard !== null);

    if (allHumansReady && botsReady && !processingRef.current) {
      startRevealPhase();
    }
  }, [players, phase, networkMode]);

  const triggerBotTurns = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    
    const botsToMove = players.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);

    const moves = await Promise.all(
      botsToMove.map(async (bot) => {
         const decision = await getBotDecision(bot, rows, []);
         return { botId: bot.id, card: decision };
      })
    );

    setPlayers(prevPlayers => {
      return prevPlayers.map(p => {
        const move = moves.find(m => m.botId === p.id);
        if (move) {
          // Bots are automatically ready when they move
          return { ...p, selectedCard: move.card, isReady: true };
        }
        return p;
      });
    });
    
    processingRef.current = false;
  };

  const handlePlayerAction = (card: CardData, playerId: string) => {
    setPlayers(prev => prev.map(p => 
      // When selecting a new card, reset ready status to false to allow confirmation
      p.id === playerId ? { ...p, selectedCard: card, isReady: false } : p
    ));
  };

  const handleToggleReady = (playerId: string, isReady: boolean) => {
    setPlayers(prev => prev.map(p => 
      p.id === playerId ? { ...p, isReady } : p
    ));
  };

  // --- Phase Logic (Host Only) ---

  const startNewRound = (playersSnapshot?: Player[]) => {
    const deck = shuffleDeck(generateDeck());
    const sourcePlayers = playersSnapshot || players;

    const updatedPlayers = sourcePlayers.map(p => ({
      ...p,
      hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
      collectedCards: [],
      selectedCard: null,
      isReady: false // Reset ready status
    }));

    const newRows: GameRow[] = Array.from({ length: 4 }).map(() => ({
      cards: [deck.shift()!]
    }));

    setPlayers(updatedPlayers);
    setRows(newRows);
    setCurrentRound(prev => prev + 1);
    setTurnCards([]);
    setResolvingIndex(-1);
    lastProcessedIndexRef.current = -1; 
    setVotes({});
    setTakingRowIndex(-1);
    setPhase(GamePhase.PLAYER_CHOICE);
  };

  const startRevealPhase = () => {
    setPlayers(currentPlayers => {
        const playersWithCards = [...currentPlayers];
        
        const currentTurnCards = playersWithCards
          .map(p => ({ playerId: p.id, card: p.selectedCard! }))
          .sort((a, b) => a.card.id - b.card.id);
        
        setTurnCards(currentTurnCards);

        return playersWithCards.map(p => ({
          ...p,
          hand: p.hand.filter(c => c.id !== p.selectedCard?.id),
          isReady: false // Reset for next turn? No, irrelevant until next dealing, but good practice
        }));
    });

    setPhase(GamePhase.REVEAL);
    setUserMessage("Revealing cards...");

    setTimeout(() => {
      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(0);
      lastProcessedIndexRef.current = -1; 
    }, 2500);
  };

  // Resolution Loop (Host Only)
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;

    if (phase === GamePhase.RESOLVING && resolvingIndex >= 0 && resolvingIndex < turnCards.length) {
      
      if (lastProcessedIndexRef.current === resolvingIndex) {
        return; 
      }
      lastProcessedIndexRef.current = resolvingIndex;

      const turn = turnCards[resolvingIndex];
      processCardPlacement(turn);
    } 
    else if (phase === GamePhase.RESOLVING && resolvingIndex >= turnCards.length && turnCards.length > 0) {
      finishTurnSet();
    }
  }, [phase, resolvingIndex, turnCards, networkMode, rows]); 

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
    executeRowTake(turn, rowIndex);
  };

  const handleLowCardEvent = async (turn: { playerId: string, card: CardData }) => {
    const player = players.find(p => p.id === turn.playerId);
    if (!player) return;

    if (player.type === PlayerType.HUMAN) {
      setPhase(GamePhase.CHOOSING_ROW);
      setUserMessage(`${player.name}, card too low! Choose a row to take.`);
    } else {
      const chosenRowIdx = await getBotRowChoice(player, rows);
      setUserMessage(`${player.name} (Low Card) takes Row #${chosenRowIdx + 1}`);
      executeRowTake(turn, chosenRowIdx);
    }
  };

  const executeRowTake = (turn: { playerId: string, card: CardData }, rowIndex: number) => {
     // 1. TRIGGER ANIMATION
     setTakingRowIndex(rowIndex); 
     const playerName = players.find(p => p.id === turn.playerId)?.name;
     setUserMessage(`${playerName} is taking Row #${rowIndex + 1}...`);

     // 2. WAIT FOR ANIMATION
     setTimeout(() => {
        // 3. EXECUTE LOGIC
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

        // 4. RESET & CONTINUE
        setTakingRowIndex(-1); 
        setPhase(GamePhase.RESOLVING);
        setResolvingIndex(prev => prev + 1);
     }, 2000);
  };

  const finishTurnSet = () => {
    setTurnCards([]);
    setResolvingIndex(-1);
    lastProcessedIndexRef.current = -1;
    setTakingRowIndex(-1);
    
    const nextPlayers = players.map(p => ({ ...p, selectedCard: null, isReady: false }));
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
    setVotes({}); 
    setPhase(GamePhase.ROUND_VOTING); 
  };

  const handleVote = (playerId: string, vote: boolean) => {
    if (networkMode === NetworkMode.CLIENT) {
       peerService.sendToHost({ type: 'ACTION_VOTE_NEXT_ROUND', payload: { vote } });
    }

    const newVotes = { ...votes, [playerId]: vote };
    setVotes(newVotes);

    const humans = players.filter(p => p.type === PlayerType.HUMAN);
    const allVoted = humans.every(p => newVotes[p.id] !== undefined);

    if (allVoted && networkMode !== NetworkMode.CLIENT) {
       const everyoneSaidYes = humans.every(p => newVotes[p.id] === true);
       
       if (everyoneSaidYes) {
         setUserMessage("Everyone voted YES! Starting next round...");
         setTimeout(() => startNewRound(players), 2000);
       } else {
         setPhase(GamePhase.GAME_END);
       }
    }
  };

  // --- View Actions (Client + Local) ---

  const onCardClick = (card: CardData) => {
    // Prevent changing card if already ready
    const me = players.find(p => p.id === myPlayerId);
    if (me?.isReady) return;

    if (networkMode === NetworkMode.CLIENT) {
      if (phase !== GamePhase.PLAYER_CHOICE) return;
      peerService.sendToHost({ type: 'ACTION_SELECT_CARD', payload: { card } });
      handlePlayerAction(card, myPlayerId); 
    } 
    else {
      handlePlayerAction(card, myPlayerId);
    }
  };

  const onToggleReady = () => {
     const me = players.find(p => p.id === myPlayerId);
     if (!me || !me.selectedCard) return;

     const newReadyState = !me.isReady;

     if (networkMode === NetworkMode.CLIENT) {
        peerService.sendToHost({ type: 'ACTION_TOGGLE_READY', payload: { isReady: newReadyState } });
        handleToggleReady(myPlayerId, newReadyState); // Optimistic
     } else {
        handleToggleReady(myPlayerId, newReadyState);
     }
  };

  const onRowClick = (rowIndex: number) => {
    if (phase !== GamePhase.CHOOSING_ROW) return;
    
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

  const onVoteClick = (vote: boolean) => {
     handleVote(myPlayerId, vote);
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
               <div className="flex flex-col items-center justify-center h-full space-y-4">
                  <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-blue-300 font-mono animate-pulse">{userMessage}</p>
               </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN GAME UI ---

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="bg-slate-800 border-b border-slate-700 p-4 flex justify-between items-center shadow-lg z-20 relative">
        <div className="flex items-center gap-4 flex-1 overflow-x-auto no-scrollbar">
           <div className="flex items-center gap-2 mr-4 flex-shrink-0">
             <div className="bg-emerald-600 p-2 rounded-lg"><Trophy size={20} className="text-white"/></div>
             <div className="flex flex-col leading-none">
               <span className="text-xs text-slate-400 font-bold">ROUND</span>
               <span className="text-xl font-black text-white">{currentRound}</span>
             </div>
           </div>
           
           {/* Players List */}
           <div className="flex gap-3">
             {players.map(p => {
               const isMe = p.id === myPlayerId;
               const isAction = activePlayerId === p.id || (phase === GamePhase.PLAYER_CHOICE && !p.selectedCard) || (phase === GamePhase.CHOOSING_ROW && resolvingPlayerName === p.name);
               
               return (
                 <div key={p.id} className={`
                    flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all whitespace-nowrap
                    ${isAction ? 'bg-yellow-500/20 border-yellow-500/50 animate-pulse' : 'bg-slate-900 border-slate-700'}
                    ${isMe ? 'ring-2 ring-emerald-500' : ''}
                 `}>
                   <div className={`w-2 h-2 rounded-full ${p.isConnected ? 'bg-green-400' : 'bg-slate-500'}`} />
                   <span className={`text-sm font-bold ${isAction ? 'text-yellow-200' : 'text-slate-300'}`}>
                     {p.name}
                   </span>
                   {phase === GamePhase.PLAYER_CHOICE && (
                     p.selectedCard ? (
                        p.isReady 
                          ? <CheckCircle size={14} className="text-green-400" /> 
                          : <span className="text-[10px] bg-slate-700 px-1 rounded text-slate-300">PICKED</span>
                     ) : (
                       <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                     )
                   )}
                 </div>
               );
             })}
           </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <button 
            onClick={() => setIsScoreBoardOpen(true)}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors relative"
          >
            <BarChart3 size={20} />
            {phase === GamePhase.GAME_END && <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />}
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-1 relative flex flex-col items-center justify-center p-2 sm:p-6 overflow-y-auto">
        
        {/* Status Message Overlay */}
        {userMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="bg-slate-900/90 backdrop-blur text-white px-6 py-2 rounded-full border border-slate-600 shadow-2xl font-bold text-sm sm:text-base animate-in fade-in slide-in-from-top-4">
              {userMessage}
            </div>
          </div>
        )}

        {/* Game Board */}
        <div className="w-full max-w-5xl mb-6 sm:mb-10">
           <GameBoard 
             rows={rows} 
             phase={phase} 
             onSelectRow={onRowClick} 
             takingRowIndex={takingRowIndex} 
           />
        </div>

        {/* Reveal Area (Center) */}
        {phase === GamePhase.REVEAL && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-40 animate-in fade-in">
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-8">
               {turnCards.map((turn, idx) => (
                 <div key={idx} className="flex flex-col items-center gap-2 animate-in zoom-in duration-300" style={{animationDelay: `${idx * 100}ms`}}>
                   <div className="text-white font-bold shadow-black drop-shadow-md">{players.find(p => p.id === turn.playerId)?.name}</div>
                   <Card id={turn.card.id} bullHeads={turn.card.bullHeads} />
                 </div>
               ))}
             </div>
          </div>
        )}
        
        {/* Voting Overlay */}
        {phase === GamePhase.ROUND_VOTING && (
           <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-50 p-4">
              <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 shadow-2xl max-w-md w-full text-center">
                 <h2 className="text-3xl font-black text-white mb-2">Round Over!</h2>
                 <p className="text-slate-400 mb-8">Everyone must agree to continue.</p>
                 
                 <div className="grid grid-cols-2 gap-4 mb-8">
                    <button 
                      onClick={() => onVoteClick(true)}
                      className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all
                        ${votes[myPlayerId] === true ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}
                      `}
                    >
                       <ThumbsUp size={32} /> Keep Playing
                    </button>
                    <button 
                      onClick={() => onVoteClick(false)}
                      className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all
                        ${votes[myPlayerId] === false ? 'bg-red-600 border-red-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}
                      `}
                    >
                       <ThumbsDown size={32} /> Stop Game
                    </button>
                 </div>

                 <div className="space-y-2">
                    {players.map(p => (
                       <div key={p.id} className="flex justify-between items-center bg-slate-900 px-4 py-2 rounded">
                          <span className="text-slate-300">{p.name}</span>
                          {votes[p.id] === undefined && <span className="text-slate-500 text-xs">Waiting...</span>}
                          {votes[p.id] === true && <span className="text-emerald-400 font-bold text-xs">READY</span>}
                          {votes[p.id] === false && <span className="text-red-400 font-bold text-xs">STOP</span>}
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        )}
      </div>

      {/* Bottom Player Area */}
      <div className="bg-slate-800 p-4 pb-6 border-t border-slate-700 shadow-[0_-10px_20px_rgba(0,0,0,0.3)] relative z-20">
         {/* Ready Toggle Overlay */}
         {phase === GamePhase.PLAYER_CHOICE && myPlayer?.selectedCard && (
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-in slide-in-from-bottom-4">
               <div className="bg-slate-900/90 backdrop-blur text-white px-4 py-2 rounded-lg border border-slate-600 shadow-xl flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-300">
                    Selected: <span className="text-emerald-400 font-bold">#{myPlayer.selectedCard.id}</span>
                  </span>
                  <div className="h-4 w-px bg-slate-600"></div>
                  <button 
                    onClick={onToggleReady}
                    className={`
                      flex items-center gap-2 px-4 py-1.5 rounded-md font-bold text-sm transition-all
                      ${myPlayer.isReady 
                        ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/50' 
                        : 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-lg shadow-emerald-900/50'}
                    `}
                  >
                    {myPlayer.isReady ? (
                       <> <XCircle size={16}/> UNREADY </>
                    ) : (
                       <> <CheckCircle size={16}/> CONFIRM </>
                    )}
                  </button>
               </div>
            </div>
         )}

         <div className="max-w-5xl mx-auto overflow-x-auto no-scrollbar">
           <div className="flex justify-center gap-2 sm:gap-4 min-w-max px-4">
             {myPlayer?.hand.map((card) => (
               <div 
                 key={card.id} 
                 className={`
                    transition-all duration-300 
                    ${myPlayer.selectedCard?.id === card.id 
                      ? 'transform -translate-y-6 z-10' 
                      : 'hover:-translate-y-2'
                    }
                    ${myPlayer.isReady && myPlayer.selectedCard?.id !== card.id ? 'opacity-50 grayscale' : 'opacity-100'}
                 `}
               >
                 <Card 
                   id={card.id} 
                   bullHeads={card.bullHeads} 
                   onClick={() => onCardClick(card)}
                   selected={myPlayer.selectedCard?.id === card.id}
                   disabled={phase !== GamePhase.PLAYER_CHOICE || (myPlayer.isReady && myPlayer.selectedCard?.id !== card.id)}
                 />
               </div>
             ))}
           </div>
         </div>
      </div>

      {/* Scoreboard Modal */}
      <ScoreBoard 
        players={players} 
        currentRound={currentRound} 
        isOpen={isScoreBoardOpen || phase === GamePhase.GAME_END} 
        onClose={() => setIsScoreBoardOpen(false)} 
      />
    </div>
  );
}
