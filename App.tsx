import React, { useState, useEffect, useRef } from 'react';
import { 
  Player, 
  CardData, 
  GameRow, 
  GamePhase, 
  GameConfig, 
  PlayerType, 
  NetworkMode,
  GameState,
  NetworkMessage
} from './types';
import { 
  generateDeck, 
  shuffleDeck, 
  findTargetRowIndex, 
  calculateRoundScore,
  TOTAL_CARDS 
} from './services/gameLogic';
import { getBotDecision, getBotRowChoice } from './services/aiService';
import { firebaseService } from './services/firebaseService';
import { audioService } from './services/audioService';
import GameBoard from './components/GameBoard';
import Card from './components/Card';
import ScoreBoard from './components/ScoreBoard';
import { Users, Bot, Play, RotateCcw, Volume2, VolumeX, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

const DEFAULT_CONFIG: GameConfig = {
  maxRounds: 10, // Not strictly used with voting logic
  totalPlayers: 4
};

const App: React.FC = () => {
  // --- Game State ---
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [numHumans, setNumHumans] = useState<number>(1);
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<GameRow[]>([]);
  const [phase, setPhase] = useState<GamePhase>(GamePhase.LOBBY);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [userMessage, setUserMessage] = useState<string>("");
  
  // Turn Management
  const [turnCards, setTurnCards] = useState<{playerId: string, card: CardData}[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState<number>(-1);
  const lastProcessedIndexRef = useRef<number>(-1); // Prevent double-processing in useEffect
  
  // UI State
  const [isScoreBoardOpen, setIsScoreBoardOpen] = useState<boolean>(false);
  const [takingRowIndex, setTakingRowIndex] = useState<number>(-1); // -1 means no animation
  const [votes, setVotes] = useState<Record<string, boolean>>({}); // For voting next round

  // Audio State
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // --- Networking State ---
  const [networkMode, setNetworkMode] = useState<NetworkMode>(NetworkMode.LOCAL);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('');
  const [joinRoomIdInput, setJoinRoomIdInput] = useState<string>('');
  const [hostName, setHostName] = useState<string>('Host');
  const [clientName, setClientName] = useState<string>('Player');
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // Initialize Audio & ID on mount
  useEffect(() => {
    const id = Math.random().toString(36).substr(2, 9);
    setMyPlayerId(id);
  }, []);

  // Toggle Mute
  const toggleMute = () => {
    const muted = audioService.toggleMute();
    setIsMuted(muted);
  };

  // --- Networking Logic ---

  const initHost = async () => {
    try {
      audioService.playClick();
      const id = await firebaseService.createRoom();
      setRoomId(id);
      setNetworkMode(NetworkMode.HOST);
      setIsConnected(true);
      
      // Add Host as first player
      const hostPlayer: Player = {
        id: myPlayerId,
        name: hostName || 'Host',
        type: PlayerType.HUMAN,
        hand: [],
        collectedCards: [],
        scoreHistory: [],
        totalScore: 0,
        selectedCard: null,
        isConnected: true,
        isReady: false
      };
      setPlayers([hostPlayer]);

      // Subscribe to actions
      firebaseService.subscribeToActions(id, handleNetworkAction);
    } catch (err) {
      alert("Failed to create room. Check console.");
      console.error(err);
    }
  };

  const joinGame = async () => {
    if (!joinRoomIdInput) return;
    audioService.playClick();
    setIsJoining(true);

    try {
      const exists = await firebaseService.joinRoom(joinRoomIdInput);
      if (!exists) {
        throw new Error("Room not found");
      }

      setRoomId(joinRoomIdInput);
      setNetworkMode(NetworkMode.CLIENT);
      setIsConnected(true);

      // Subscribe to game state
      firebaseService.subscribeToGameState(joinRoomIdInput, (state) => {
        if (state) {
          setPlayers(state.players || []);
          setRows(state.rows || []);
          setPhase(state.phase);
          setCurrentRound(state.currentRound);
          setTurnCards(state.turnCards || []);
          setResolvingIndex(state.resolvingIndex);
          setUserMessage(state.userMessage || "");
          setVotes(state.votes || {});
          setTakingRowIndex(state.takingRowIndex ?? -1); // Sync animation state
        }
      });

      // Announce join
      firebaseService.sendAction(joinRoomIdInput, {
        type: 'PLAYER_JOINED',
        payload: { id: myPlayerId, name: clientName || 'Player' }
      });

    } catch (err: any) {
      alert(err.message || "Failed to join.");
      setIsJoining(false);
    }
  };

  // Handle incoming actions (Host only)
  const handleNetworkAction = (msg: NetworkMessage) => {
    switch (msg.type) {
      case 'PLAYER_JOINED':
        setPlayers(prev => {
          if (prev.find(p => p.id === msg.payload.id)) return prev;
          const newPlayer: Player = {
            id: msg.payload.id,
            name: msg.payload.name,
            type: PlayerType.HUMAN,
            hand: [],
            collectedCards: [],
            scoreHistory: [],
            totalScore: 0,
            selectedCard: null,
            isConnected: true,
            isReady: false
          };
          return [...prev, newPlayer];
        });
        audioService.playSelect();
        break;
        
      case 'ACTION_SELECT_CARD':
        handleCardSelection(msg.payload.playerId, msg.payload.card);
        break;

      case 'ACTION_SELECT_ROW':
        handleHumanRowSelect(msg.payload.rowIndex, msg.payload.playerId);
        break;
      
      case 'ACTION_TOGGLE_READY':
        handleToggleReady(msg.payload.playerId, msg.payload.isReady);
        break;
        
      case 'ACTION_VOTE_NEXT_ROUND':
        handleVote(msg.payload.playerId, msg.payload.vote);
        break;
    }
  };

  // Broadcast state (Host only)
  useEffect(() => {
    if (networkMode === NetworkMode.HOST && roomId) {
      const state: GameState = {
        players,
        rows,
        phase,
        currentRound,
        activePlayerId: null,
        turnCards,
        resolvingIndex,
        userMessage,
        votes,
        takingRowIndex
      };
      firebaseService.updateGameState(roomId, state);
    }
  }, [players, rows, phase, currentRound, turnCards, resolvingIndex, userMessage, votes, takingRowIndex, networkMode, roomId]);


  // --- Game Loop Logic (Host) ---

  const startGame = () => {
    audioService.playClick();
    
    // If local mode, fill with bots
    if (networkMode === NetworkMode.LOCAL) {
      const total = config.totalPlayers;
      const humans = numHumans;
      const botsNeeded = total - humans;
      
      const newPlayers: Player[] = [];
      // Add humans
      for (let i = 0; i < humans; i++) {
        newPlayers.push({
          id: `human-${i}`,
          name: i === 0 ? 'Player 1' : `Player ${i+1}`,
          type: PlayerType.HUMAN,
          hand: [],
          collectedCards: [],
          scoreHistory: [],
          totalScore: 0,
          selectedCard: null,
          isReady: false
        });
      }
      // Add bots
      for (let i = 0; i < botsNeeded; i++) {
        newPlayers.push({
          id: `bot-${i}`,
          name: `Bot ${i+1}`,
          type: PlayerType.BOT,
          hand: [],
          collectedCards: [],
          scoreHistory: [],
          totalScore: 0,
          selectedCard: null,
          isReady: false
        });
      }
      setPlayers(newPlayers);
      startNewRound(newPlayers);
    } else {
      // Host mode: fill remaining slots with bots
      const currentPlayers = [...players];
      const botsNeeded = config.totalPlayers - currentPlayers.length;
      for (let i = 0; i < botsNeeded; i++) {
        currentPlayers.push({
          id: `bot-${Date.now()}-${i}`,
          name: `Bot ${i+1}`,
          type: PlayerType.BOT,
          hand: [],
          collectedCards: [],
          scoreHistory: [],
          totalScore: 0,
          selectedCard: null,
          isConnected: true,
          isReady: false
        });
      }
      setPlayers(currentPlayers);
      startNewRound(currentPlayers);
    }
  };

  const startNewRound = (currentPlayers: Player[] = players) => {
    setPhase(GamePhase.DEALING);
    setTurnCards([]);
    setResolvingIndex(-1);
    lastProcessedIndexRef.current = -1;
    setUserMessage(`Round ${currentRound} Starting!`);
    setVotes({});
    audioService.playFanfare(); // Use fanfare as start sound too

    // Generate Deck & Deal
    const deck = shuffleDeck(generateDeck());
    
    // Deal 10 cards to each player
    const updatedPlayers = currentPlayers.map(p => ({
      ...p,
      hand: deck.splice(0, 10).sort((a, b) => a.id - b.id),
      collectedCards: [], // Reset collected for the round
      selectedCard: null,
      isReady: false // Reset ready state
    }));

    // Deal 4 rows of 1 card each
    const newRows: GameRow[] = [];
    for (let i = 0; i < 4; i++) {
      newRows.push({ cards: [deck.shift()!] });
    }

    setPlayers(updatedPlayers);
    setRows(newRows);

    setTimeout(() => {
      setPhase(GamePhase.PLAYER_CHOICE);
      triggerBotTurns(updatedPlayers, newRows);
    }, 1000);
  };

  const triggerBotTurns = (currentPlayers: Player[], currentRows: GameRow[]) => {
    currentPlayers.forEach(player => {
      if (player.type === PlayerType.BOT) {
        setTimeout(async () => {
          // Use functional update to prevent stale state (Human might have picked in meantime)
          const decision = await getBotDecision(player, currentRows, []);
          
          setPlayers(prevPlayers => prevPlayers.map(p => {
             if (p.id === player.id) {
               return { ...p, selectedCard: decision, isReady: true };
             }
             return p;
          }));
        }, 1000 + Math.random() * 2000);
      }
    });
  };

  // --- Interaction Handlers ---

  const handleCardSelection = (playerId: string, card: CardData) => {
    if (networkMode === NetworkMode.CLIENT && playerId === myPlayerId) {
      firebaseService.sendAction(roomId, {
        type: 'ACTION_SELECT_CARD',
        payload: { card, playerId }
      });
      return;
    }

    // Host Logic (or Local)
    audioService.playClick();
    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) {
        return { ...p, selectedCard: card, isReady: false }; // Default not ready, wait for confirm
      }
      return p;
    }));
  };

  const handleToggleReady = (playerId: string, isReady: boolean) => {
    if (networkMode === NetworkMode.CLIENT && playerId === myPlayerId) {
      firebaseService.sendAction(roomId, {
        type: 'ACTION_TOGGLE_READY',
        payload: { isReady, playerId }
      });
      return;
    }

    // Host Logic
    if (isReady) audioService.playSelect();
    setPlayers(prev => prev.map(p => {
      if (p.id === playerId) return { ...p, isReady };
      return p;
    }));
  };

  // Check if all players are ready to reveal
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;
    if (phase !== GamePhase.PLAYER_CHOICE) return;

    const allReady = players.every(p => p.selectedCard !== null && p.isReady);
    if (allReady && players.length > 0) {
      startRevealPhase();
    }
  }, [players, phase, networkMode]);

  const startRevealPhase = () => {
    setPhase(GamePhase.REVEAL);
    lastProcessedIndexRef.current = -1;
    audioService.playFanfare();

    // Collect and sort selected cards
    const moves = players.map(p => ({
      playerId: p.id,
      card: p.selectedCard!
    })).sort((a, b) => a.card.id - b.card.id);

    setTurnCards(moves);
    
    // Clear selected cards from hands
    setPlayers(prev => prev.map(p => ({
      ...p,
      hand: p.hand.filter(c => c.id !== p.selectedCard!.id),
      selectedCard: null,
      isReady: false
    })));

    // Start resolving after delay
    setTimeout(() => {
      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(0);
    }, 2000);
  };

  // Resolve Loop
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;
    if (phase !== GamePhase.RESOLVING) return;
    if (resolvingIndex < 0) return;

    // Game End Check
    if (resolvingIndex >= turnCards.length) {
      finishTurnSet();
      return;
    }

    // Prevent double processing
    if (lastProcessedIndexRef.current === resolvingIndex) return;
    lastProcessedIndexRef.current = resolvingIndex;

    const turn = turnCards[resolvingIndex];
    const player = players.find(p => p.id === turn.playerId);
    if (!player) return;

    audioService.playCardSlide();

    setTimeout(() => {
      const rowIndex = findTargetRowIndex(turn.card, rows);
      
      if (rowIndex === -1) {
        handleLowCardEvent(player, turn.card);
      } else {
        placeCardInRow(rowIndex, turn.card, player);
      }
    }, 1500); // Delay for animation

  }, [resolvingIndex, phase, networkMode, rows]); // Added rows to dep to avoid stale state

  const handleLowCardEvent = (player: Player, card: CardData) => {
    if (player.type === PlayerType.HUMAN) {
      setPhase(GamePhase.CHOOSING_ROW);
      audioService.playAlert();
      setUserMessage(`${player.name}, card too low! Choose a row to take.`);
    } else {
      // Bot Logic
      getBotRowChoice(player, rows).then(idx => {
        executeRowTake(idx, player.id); // Directly execute
      });
    }
  };

  const handleHumanRowSelect = (rowIndex: number, playerId: string) => {
    if (networkMode === NetworkMode.CLIENT && playerId === myPlayerId) {
      firebaseService.sendAction(roomId, {
        type: 'ACTION_SELECT_ROW',
        payload: { rowIndex, playerId }
      });
      return;
    }

    // Host checks validity
    if (phase !== GamePhase.CHOOSING_ROW) return;
    const activePlayerId = turnCards[resolvingIndex].playerId;
    if (activePlayerId !== playerId) return;

    setUserMessage(`${players.find(p => p.id === playerId)?.name} taking row...`);
    executeRowTake(rowIndex, playerId);
  };

  const executeRowTake = (rowIndex: number, playerId: string) => {
    // Set visual state for all clients
    setTakingRowIndex(rowIndex);
    audioService.playTakeRow();

    // Delay actual state update to allow animation
    setTimeout(() => {
      setPlayers(prev => prev.map(p => {
        if (p.id === playerId) {
          return { ...p, collectedCards: [...p.collectedCards, ...rows[rowIndex].cards] };
        }
        return p;
      }));

      const cardToPlace = turnCards[resolvingIndex].card;
      const newRows = [...rows];
      newRows[rowIndex] = { cards: [cardToPlace] };
      setRows(newRows);

      // Clear animation and move next
      setTakingRowIndex(-1);
      setPhase(GamePhase.RESOLVING);
      setResolvingIndex(prev => prev + 1);
    }, 2000); // 2s animation
  };

  const placeCardInRow = (rowIndex: number, card: CardData, player: Player) => {
    const targetRow = rows[rowIndex];
    
    if (targetRow.cards.length >= 5) {
      // 6th Card Rule
      setTakingRowIndex(rowIndex); // Trigger animation
      audioService.playTakeRow();
      setUserMessage(`${player.name} takes Row ${rowIndex + 1} (6th Card)!`);
      
      setTimeout(() => {
         setPlayers(prev => prev.map(p => {
          if (p.id === player.id) {
            return { ...p, collectedCards: [...p.collectedCards, ...targetRow.cards] };
          }
          return p;
        }));

        const newRows = [...rows];
        newRows[rowIndex] = { cards: [card] };
        setRows(newRows);
        
        setTakingRowIndex(-1);
        setResolvingIndex(prev => prev + 1);
      }, 2000);

    } else {
      // Normal Placement
      const newRows = [...rows];
      newRows[rowIndex] = { cards: [...targetRow.cards, card] };
      setRows(newRows);
      setResolvingIndex(prev => prev + 1);
    }
  };

  const finishTurnSet = () => {
    // Check if round is over (hands empty)
    const handEmpty = players[0].hand.length === 0;
    
    if (handEmpty) {
      calculateScoresAndNextRound();
    } else {
      setPhase(GamePhase.PLAYER_CHOICE);
      setResolvingIndex(-1);
      setTurnCards([]);
      // Trigger bots for next turn
      triggerBotTurns(players, rows);
    }
  };

  const calculateScoresAndNextRound = () => {
    // Calculate scores with new players state
    const playersWithScores = players.map(p => {
      const roundScore = calculateRoundScore(p, players);
      return {
        ...p,
        scoreHistory: [...p.scoreHistory, { score: roundScore, heads: p.collectedCards.reduce((s, c) => s + c.bullHeads, 0) }],
        totalScore: p.totalScore + roundScore
      };
    });

    setPlayers(playersWithScores);
    setIsScoreBoardOpen(true);
    setPhase(GamePhase.ROUND_VOTING); // Enter Voting Phase
    setVotes({});
  };

  const handleVote = (playerId: string, vote: boolean) => {
    if (networkMode === NetworkMode.CLIENT && playerId === myPlayerId) {
      firebaseService.sendAction(roomId, {
        type: 'ACTION_VOTE_NEXT_ROUND',
        payload: { vote, playerId }
      });
      return;
    }

    // Host updates votes
    const newVotes = { ...votes, [playerId]: vote };
    setVotes(newVotes);

    // Check for unanimity or rejection
    const humans = players.filter(p => p.type === PlayerType.HUMAN);
    const allHumansVoted = humans.every(h => newVotes[h.id] !== undefined);
    
    if (allHumansVoted) {
       const anyReject = humans.some(h => newVotes[h.id] === false);
       
       if (anyReject) {
         // End Game
         setPhase(GamePhase.GAME_END);
         audioService.playFanfare();
       } else {
         // Continue to next round
         setTimeout(() => {
           setCurrentRound(prev => prev + 1);
           startNewRound(players); // Pass updated players (with scores)
           setIsScoreBoardOpen(false);
         }, 1000);
       }
    }
  };

  // --- Render Helpers ---

  const myPlayer = players.find(p => p.id === myPlayerId);
  
  // Determine if it's my turn to choose a row (P2P or Local Hotseat logic)
  const resolvingTurn = resolvingIndex >= 0 && resolvingIndex < turnCards.length ? turnCards[resolvingIndex] : null;
  const resolvingPlayer = resolvingTurn ? players.find(p => p.id === resolvingTurn.playerId) : null;
  const resolvingPlayerName = resolvingPlayer?.name;

  const isMyTurnToChooseRow = phase === GamePhase.CHOOSING_ROW && (
    (networkMode === NetworkMode.LOCAL && resolvingPlayer?.type === PlayerType.HUMAN) || 
    (resolvingPlayer?.id === myPlayerId)
  );

  // --- Render ---

  if (phase === GamePhase.LOBBY && !isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500 mb-8 animate-in fade-in slide-in-from-bottom-4">
          COW KING
        </h1>
        
        <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
          {/* Host Card */}
          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl hover:border-emerald-500/50 transition-colors group">
             <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
               <Users className="text-emerald-400" /> Create Game (Host)
             </h2>
             
             <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Your Name</label>
                  <input 
                    type="text" 
                    value={hostName} 
                    onChange={(e) => setHostName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Total Players</label>
                    <select 
                      value={config.totalPlayers} 
                      onChange={(e) => setConfig({...config, totalPlayers: Number(e.target.value)})}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2"
                    >
                      {[4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">Humans</label>
                    <select 
                      value={numHumans} 
                      onChange={(e) => setNumHumans(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2"
                    >
                      {Array.from({length: config.totalPlayers}, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="text-sm text-slate-500 flex items-center gap-2">
                  <Bot size={16} /> Auto-filling {config.totalPlayers - numHumans} Bots
                </div>

                <div className="flex gap-2 pt-4">
                  <button 
                    onClick={startGame}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    Play Local (Hotseat)
                  </button>
                  <button 
                    onClick={initHost}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all"
                  >
                    Host Online
                  </button>
                </div>
             </div>
          </div>

          {/* Join Card */}
          <div className="bg-slate-900/50 border border-slate-800 p-8 rounded-2xl hover:border-blue-500/50 transition-colors">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
               <Users className="text-blue-400" /> Join Game
             </h2>
             
             <div className="space-y-4">
               <div>
                  <label className="block text-sm text-slate-400 mb-1">Your Name</label>
                  <input 
                    type="text" 
                    value={clientName} 
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm text-slate-400 mb-1">Enter 4-Digit Room ID</label>
                  <input 
                    type="text" 
                    value={joinRoomIdInput} 
                    onChange={(e) => setJoinRoomIdInput(e.target.value)}
                    placeholder="e.g. 1234"
                    maxLength={4}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-mono tracking-widest text-center text-xl"
                  />
                </div>

                <button 
                  onClick={joinGame}
                  disabled={isJoining}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white font-bold py-3 rounded-lg transition-all flex items-center justify-center gap-2"
                >
                  {isJoining ? <Loader2 className="animate-spin" /> : 'Join Room'}
                </button>
             </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Game Render ---

  // Check if it's currently my turn in the UI
  const myHand = myPlayer ? myPlayer.hand : [];
  const isMyTurn = phase === GamePhase.PLAYER_CHOICE && myPlayer?.selectedCard === null;

  // Waiting Lobby (Host View)
  if (networkMode === NetworkMode.HOST && phase === GamePhase.LOBBY && isConnected) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-700 max-w-md w-full text-center">
          <h2 className="text-3xl font-bold mb-2 text-emerald-400">Room Created!</h2>
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 my-6">
            <span className="text-slate-500 text-sm uppercase tracking-widest">Room ID</span>
            <div className="text-6xl font-mono font-black tracking-wider mt-2 text-white select-all">
              {roomId}
            </div>
          </div>
          
          <div className="space-y-2 mb-8">
            <h3 className="text-slate-400 font-bold text-sm uppercase">Players Joined ({players.length}/{config.totalPlayers})</h3>
            {players.map(p => (
              <div key={p.id} className="flex items-center gap-2 justify-center text-lg">
                 <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                 {p.name}
              </div>
            ))}
          </div>

          <button 
            onClick={startGame}
            disabled={players.length < 2} // Allow starting with bots
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold py-4 rounded-xl transition-all text-xl"
          >
            Start Game
          </button>
        </div>
      </div>
    );
  }

  // Waiting Lobby (Client View)
  if (networkMode === NetworkMode.CLIENT && phase === GamePhase.LOBBY) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4">
         <Loader2 size={48} className="text-blue-500 animate-spin mb-4" />
         <h2 className="text-2xl font-bold">Connected to Room {roomId}</h2>
         <p className="text-slate-400 mt-2">Waiting for host to start...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="bg-slate-900 border-b border-slate-800 p-2 sm:p-4 flex items-center justify-between shadow-xl z-20">
        <div className="flex items-center gap-4">
          <h1 className="text-xl sm:text-2xl font-black text-emerald-400 hidden sm:block">COW KING</h1>
          <div className="flex items-center gap-2 text-sm sm:text-base bg-slate-800 px-3 py-1 rounded-full border border-slate-700">
            <RotateCcw size={16} className="text-slate-400"/>
            <span>Round <span className="text-white font-bold">{currentRound}</span></span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
           {/* Player Status Bar */}
           <div className="flex items-center gap-2 overflow-x-auto max-w-[200px] sm:max-w-md no-scrollbar">
             {players.map(p => (
               <div 
                  key={p.id} 
                  className={`
                    flex items-center gap-1 px-2 py-1 rounded text-xs font-bold whitespace-nowrap border
                    ${p.id === resolvingPlayerName ? 'bg-yellow-500/20 border-yellow-500 text-yellow-200' : 'bg-slate-800 border-slate-700 text-slate-400'}
                    ${p.isReady ? 'border-green-500/50' : ''}
                  `}
                >
                  {p.isReady && <CheckCircle2 size={10} className="text-green-400" />}
                  {p.name}
                  <span className="bg-slate-900 px-1 rounded text-slate-500">{p.totalScore}</span>
               </div>
             ))}
           </div>

           <button onClick={toggleMute} className="p-2 hover:bg-slate-800 rounded-full">
             {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
           </button>

           <button 
             onClick={() => setIsScoreBoardOpen(true)}
             className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg font-bold text-sm border border-slate-600 transition-colors"
           >
             Scores
           </button>
        </div>
      </div>
      
      {/* Main Game Area */}
      <div className="flex-1 relative flex flex-col overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-slate-950">
         
         {/* Message Overlay (Toast) */}
         {userMessage && (
           <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-800/90 backdrop-blur border border-slate-600 text-white px-6 py-2 rounded-full shadow-xl z-40 animate-in fade-in slide-in-from-top-4 font-medium text-center max-w-[90%]">
             {userMessage}
           </div>
         )}

         {/* Game Board */}
         <GameBoard 
           rows={rows} 
           phase={phase} 
           onSelectRow={(idx) => handleHumanRowSelect(idx, myPlayerId)} 
           takingRowIndex={takingRowIndex}
           turnCards={turnCards}
           resolvingIndex={resolvingIndex}
           players={players}
           isMyTurnToChooseRow={isMyTurnToChooseRow}
           choosingPlayerName={resolvingPlayerName}
         />

         {/* Voting Overlay */}
         {phase === GamePhase.ROUND_VOTING && (
           <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in">
              <div className="bg-slate-900 p-8 rounded-2xl border border-slate-700 shadow-2xl max-w-md w-full text-center">
                 <h2 className="text-2xl font-bold mb-4">Round Finished!</h2>
                 <p className="text-slate-400 mb-8">Do you want to continue to the next round?</p>
                 
                 {myPlayer && votes[myPlayer.id] === undefined ? (
                   <div className="flex gap-4">
                      <button 
                        onClick={() => handleVote(myPlayer.id, false)}
                        className="flex-1 bg-red-900/50 hover:bg-red-900 border border-red-800 text-red-200 py-4 rounded-xl font-bold transition-all flex flex-col items-center gap-2"
                      >
                        <XCircle /> Stop Game
                      </button>
                      <button 
                        onClick={() => handleVote(myPlayer.id, true)}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-500 border border-emerald-400 text-white py-4 rounded-xl font-bold transition-all flex flex-col items-center gap-2"
                      >
                        <Play /> Keep Playing
                      </button>
                   </div>
                 ) : (
                   <div className="text-emerald-400 font-bold flex items-center justify-center gap-2">
                     <CheckCircle2 /> Vote Submitted
                   </div>
                 )}

                 <div className="mt-8 pt-8 border-t border-slate-800">
                   <h3 className="text-xs font-bold text-slate-500 uppercase mb-4">Voting Status</h3>
                   <div className="grid grid-cols-2 gap-2">
                      {players.filter(p => p.type === PlayerType.HUMAN).map(p => (
                        <div key={p.id} className="flex items-center justify-between bg-slate-950 px-3 py-2 rounded border border-slate-800">
                          <span className="text-sm">{p.name}</span>
                          {votes[p.id] === undefined && <span className="text-slate-500 text-xs">Thinking...</span>}
                          {votes[p.id] === true && <CheckCircle2 size={16} className="text-emerald-500" />}
                          {votes[p.id] === false && <XCircle size={16} className="text-red-500" />}
                        </div>
                      ))}
                   </div>
                 </div>
              </div>
           </div>
         )}

         {/* Player Hand Area */}
         <div className="mt-auto bg-slate-900/80 border-t border-slate-800 pt-8 pb-4 sm:pb-8 px-2 sm:px-4 backdrop-blur-md relative z-30">
            
            {/* Confirm Selection Overlay */}
            {myPlayer?.selectedCard && !myPlayer.isReady && phase === GamePhase.PLAYER_CHOICE && (
               <div className="absolute -top-16 left-1/2 -translate-x-1/2 flex gap-2 animate-in slide-in-from-bottom-4 fade-in">
                  <div className="bg-slate-800 text-white px-4 py-2 rounded-lg border border-slate-600 shadow-xl flex items-center gap-2">
                     <span className="text-slate-400 text-sm">Selected:</span>
                     <span className="font-bold text-emerald-400">#{myPlayer.selectedCard.id}</span>
                  </div>
                  <button 
                    onClick={() => handleToggleReady(myPlayer.id, true)}
                    className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold px-6 py-2 rounded-lg shadow-lg shadow-emerald-900/50 transition-all flex items-center gap-2"
                  >
                    <CheckCircle2 size={18} /> CONFIRM
                  </button>
               </div>
            )}

            {/* Unready Button */}
            {myPlayer?.isReady && phase === GamePhase.PLAYER_CHOICE && (
               <div className="absolute -top-14 left-1/2 -translate-x-1/2">
                  <button 
                    onClick={() => handleToggleReady(myPlayer.id, false)}
                    className="bg-slate-700/80 hover:bg-slate-600 text-slate-300 font-bold px-4 py-2 rounded-full border border-slate-500 backdrop-blur text-sm flex items-center gap-2"
                  >
                    <RotateCcw size={14} /> Change Card
                  </button>
               </div>
            )}

            {/* Hand Scroll Container */}
            <div className="flex justify-center overflow-x-auto no-scrollbar pb-4 pt-4 min-h-[160px]">
              <div className="flex gap-[-40px] sm:gap-2 px-4 min-w-max">
                {myHand.map((card) => (
                  <div 
                    key={card.id} 
                    className={`transform transition-all duration-300 hover:z-10 ${myPlayer?.selectedCard?.id === card.id ? '-translate-y-6 z-10' : 'hover:-translate-y-4'}`}
                  >
                    <Card 
                      id={card.id} 
                      bullHeads={card.bullHeads} 
                      onClick={() => {
                        if (phase === GamePhase.PLAYER_CHOICE && !myPlayer?.isReady) {
                          handleCardSelection(myPlayerId, card);
                        }
                      }}
                      selected={myPlayer?.selectedCard?.id === card.id}
                      disabled={phase !== GamePhase.PLAYER_CHOICE || myPlayer?.isReady}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Helper text */}
            <div className="text-center text-slate-500 text-xs sm:text-sm font-medium mt-[-10px]">
              {phase === GamePhase.PLAYER_CHOICE 
                ? (myPlayer?.isReady ? "Waiting for others..." : "Pick a card to play") 
                : "Watch the round unfold..."}
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
};

export default App;