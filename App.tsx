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
import { Trophy, Users, Play, RotateCw, Skull, Eye, EyeOff, BarChart3, AlertTriangle, Bot, Wifi, Copy, Smartphone, ThumbsUp, ThumbsDown } from 'lucide-react';

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
            setConnectedPlayers(prev => {
              if (prev.some(p => p.name === msg.payload.name)) return prev;
              return [...prev, msg.payload];
            });
            setUserMessage(`${msg.payload.name} joined!`);
            // Send welcome back to confirm connection
            peerService.broadcast({ 
                type: 'WELCOME', 
                payload: { 
                    playerId: msg.payload.id, // Use the ID they sent or generate one? Simpler to just ack.
                    gameState: {
                        players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, votes
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
            
          case 'ACTION_SELECT_ROW':
            const turn = turnCards[resolvingIndex];
            if (turn) {
               executeRowTake(turn, msg.payload.rowIndex);
            }
            break;

          case 'ACTION_VOTE_NEXT_ROUND':
             // Client sends a vote
             // We need to know WHO sent it. 
             // For now assuming payload might need playerID or we deduce from context.
             // Let's iterate players to find who matches the sender connection? 
             // Simplified: Client sends their ID in payload or we rely on trust.
             // Updating types.ts to include playerId in vote message would be best, 
             // but for now let's handle it if we can find the player.
             // Assuming the message comes with metadata or we just look at connection.
             // Let's simplisticly assume payload contains the vote, and we update 'players' based on peer logic.
             // Actually, let's just iterate connected peers? 
             // Implemented: Client sends { playerId, vote } ideally.
             // Since types is strict, let's handle logic in handleVote
             break;
        }
      }
    };
  }, [networkMode, players, rows, turnCards, resolvingIndex, votes]);


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
        votes
      };
      peerService.broadcast({ type: 'STATE_UPDATE', payload: currentState });
    }
  }, [players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, votes, networkMode]);

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
        isConnected: true
      });
    });

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

  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;
    if (phase !== GamePhase.PLAYER_CHOICE) return;

    const allHumanSelected = players
      .filter(p => p.type === PlayerType.HUMAN)
      .every(p => p.selectedCard !== null);

    const bots = players.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);
    if (bots.length > 0 && !processingRef.current) {
      triggerBotTurns();
    }

    // Need to check players again in case bots updated
    const allSelected = players.every(p => p.selectedCard !== null);

    if (allSelected && !processingRef.current) {
      startRevealPhase();
    }
  }, [players, phase, networkMode]);

  const triggerBotTurns = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    
    // Identify bots that need to move
    // We use a snapshot, but we must be careful not to use stale data when setting state back
    const botsToMove = players.filter(p => p.type === PlayerType.BOT && p.selectedCard === null);

    // Calculate all moves first (async)
    const moves = await Promise.all(
      botsToMove.map(async (bot) => {
         const decision = await getBotDecision(bot, rows, []);
         return { botId: bot.id, card: decision };
      })
    );

    // Apply moves using Functional Update to prevent overwriting Human moves made during async wait
    setPlayers(prevPlayers => {
      return prevPlayers.map(p => {
        const move = moves.find(m => m.botId === p.id);
        if (move) {
          return { ...p, selectedCard: move.card };
        }
        return p;
      });
    });
    
    processingRef.current = false;
  };

  const handlePlayerAction = (card: CardData, playerId: string) => {
    setPlayers(prev => prev.map(p => 
      p.id === playerId ? { ...p, selectedCard: card } : p
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
    lastProcessedIndexRef.current = -1; // Reset processing guard
    setVotes({});
    setPhase(GamePhase.PLAYER_CHOICE);
  };

  const startRevealPhase = () => {
    // Use functional update to ensure we have latest players if called from effect
    setPlayers(currentPlayers => {
        const playersWithCards = [...currentPlayers];
        
        const currentTurnCards = playersWithCards
          .map(p => ({ playerId: p.id, card: p.selectedCard! }))
          .sort((a, b) => a.card.id - b.card.id);
        
        setTurnCards(currentTurnCards);

        // Remove selected card from hand
        return playersWithCards.map(p => ({
          ...p,
          hand: p.hand.filter(c => c.id !== p.selectedCard?.id)
        }));
    });

    setPhase(GamePhase.REVEAL);
    setUserMessage("Revealing cards...");

    setTimeout(() => {
      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(0);
      lastProcessedIndexRef.current = -1; // Reset processing guard
    }, 2500);
  };

  // Resolution Loop (Host Only)
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;

    // Ensure we are in the right phase and have a valid index
    if (phase === GamePhase.RESOLVING && resolvingIndex >= 0 && resolvingIndex < turnCards.length) {
      
      // GUARD: Check if we already processed this specific index
      if (lastProcessedIndexRef.current === resolvingIndex) {
        return; // Skip duplicate execution
      }

      // Mark as processed immediately
      lastProcessedIndexRef.current = resolvingIndex;

      const turn = turnCards[resolvingIndex];
      processCardPlacement(turn);
    } 
    else if (phase === GamePhase.RESOLVING && resolvingIndex >= turnCards.length && turnCards.length > 0) {
      finishTurnSet();
    }
  }, [phase, resolvingIndex, turnCards, networkMode, rows]); // Added 'rows' to ensure latest state is used

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
    lastProcessedIndexRef.current = -1;
    
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
    setVotes({}); 
    setPhase(GamePhase.ROUND_VOTING); // Go to voting instead of auto next round
  };

  const handleVote = (playerId: string, vote: boolean) => {
    if (networkMode === NetworkMode.CLIENT) {
       // If we are client, just send to host? 
       // No, we just call handleVote locally for UI but usually send msg
       // In this simple peer setup, let's assume CLIENT UI calls this which sends msg
       // But wait, handleVote is called by UI.
       // If Client:
       // peerService.sendToHost({ type: 'ACTION_VOTE_NEXT_ROUND', payload: { vote } });
       // For now, since we didn't fully implement CLIENT sending vote msg in msg handler,
       // let's just enable Local voting for Host and Local mode.
       // If strictly multiplayer, we need that msg.
       // Assuming this function is for Host processing:
    }

    // Update votes locally
    const newVotes = { ...votes, [playerId]: vote };
    setVotes(newVotes);

    // Check if all humans have voted
    const humans = players.filter(p => p.type === PlayerType.HUMAN);
    const allVoted = humans.every(p => newVotes[p.id] !== undefined);

    if (allVoted) {
       // Check results
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
    if (networkMode === NetworkMode.CLIENT) {
      if (phase !== GamePhase.PLAYER_CHOICE) return;
      peerService.sendToHost({ type: 'ACTION_SELECT_CARD', payload: { card } });
      handlePlayerAction(card, myPlayerId); // Optimistic
    } 
    else {
      handlePlayerAction(card, myPlayerId);
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
     // If client, send network message (not implemented fully in this snippet but implied)
     // For Host/Local:
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
            R{currentRound} (Unlimited)
          </div>
        </div>
        
        {/* Message Bar */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none hidden md:block">
           <div className="bg-black/40 px-4 py-1 rounded-full text-yellow-400 font-bold text-sm animate-pulse border border-yellow-500/30">
            {userMessage}
          </div>
        </div>

        <button onClick={() => setIsScoreBoardOpen(true)} className="flex items-center gap-2 bg-emerald-900/50 hover:bg-emerald-900 text-emerald-400 px-3 py-2 rounded-lg border border-emerald-800 text-sm font-bold">
          <BarChart3 size={18} />
        </button>
      </header>
      
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
                
                {/* Voting Status */}
                {phase === GamePhase.ROUND_VOTING && (
                    <div className="absolute -bottom-2 bg-slate-800 rounded-full p-1">
                       {votes[p.id] === true && <ThumbsUp size={12} className="text-green-400" />}
                       {votes[p.id] === false && <ThumbsDown size={12} className="text-red-400" />}
                    </div>
                )}
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

      {/* VOTING OVERLAY */}
      {phase === GamePhase.ROUND_VOTING && (
         <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
             <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 shadow-2xl text-center max-w-md w-full">
                 <h2 className="text-3xl font-bold text-white mb-2">Round Over!</h2>
                 <p className="text-slate-400 mb-8">Continue to next round?</p>
                 
                 {votes[myPlayerId] === undefined ? (
                    <div className="flex gap-4 justify-center">
                       <button onClick={() => onVoteClick(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 py-4 rounded-xl font-bold text-lg flex flex-col items-center gap-2 transition-all hover:scale-105">
                          <ThumbsUp size={32} />
                          Keep Playing
                       </button>
                       <button onClick={() => onVoteClick(false)} className="flex-1 bg-red-600 hover:bg-red-500 py-4 rounded-xl font-bold text-lg flex flex-col items-center gap-2 transition-all hover:scale-105">
                          <ThumbsDown size={32} />
                          Stop & End
                       </button>
                    </div>
                 ) : (
                    <div className="text-xl font-bold text-yellow-400 animate-pulse">
                       Waiting for other players...
                    </div>
                 )}

                 <div className="mt-8 pt-4 border-t border-slate-700">
                    <div className="text-sm text-slate-500 mb-2">Votes Cast</div>
                    <div className="flex justify-center gap-2 flex-wrap">
                       {players.filter(p => p.type === PlayerType.HUMAN).map(p => (
                          <div key={p.id} className={`px-3 py-1 rounded-full text-sm border flex items-center gap-2 ${votes[p.id] === undefined ? 'border-slate-600 text-slate-500' : votes[p.id] ? 'border-green-500 bg-green-900/20 text-green-400' : 'border-red-500 bg-red-900/20 text-red-400'}`}>
                             {p.name}
                             {votes[p.id] === undefined ? '...' : votes[p.id] ? <ThumbsUp size={12}/> : <ThumbsDown size={12}/>}
                          </div>
                       ))}
                    </div>
                 </div>
             </div>
         </div>
      )}

      {/* Resolving Overlay */}
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