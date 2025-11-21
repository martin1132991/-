
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Player, CardData, GameRow, GamePhase, NetworkMode, 
  GameState, NetworkMessage, PlayerType, ChatMessage, RoundResult
} from './types';
import { 
  generateDeck, shuffleDeck, findTargetRowIndex, 
  calculateRoundScore, sumBullHeads 
} from './services/gameLogic';
import { getBotDecision, getBotRowChoice } from './services/aiService';
import GameBoard from './components/GameBoard';
import ScoreBoard from './components/ScoreBoard';
import Card from './components/Card';
import { audioService } from './services/audioService';
import { firebaseService } from './services/firebaseService';
import { 
  Copy, Play, Users, Volume2, VolumeX, Zap, LogOut, Loader, PlayCircle,
  MessageSquare, Send, Smile, X, Check, RefreshCcw, Clock, AlarmClock, Trophy, User, ThumbsUp, ThumbsDown
} from 'lucide-react';

const HAND_SIZE = 10;

const PRESET_REACTIONS = [
  "😂", "👍", "👎", "😡", "😱", "🐮", "⚡", "🤔",
  "GG", "Nice!", "Ouch", "Speed!", "Wait...", "Lucky"
];

function App() {
  // --- State ---
  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<GameRow[]>([]);
  const [phase, setPhase] = useState<GamePhase>(GamePhase.LOBBY);
  const [currentRound, setCurrentRound] = useState(1);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [turnCards, setTurnCards] = useState<{playerId: string, card: CardData}[]>([]);
  const [resolvingIndex, setResolvingIndex] = useState(-1);
  const [userMessage, setUserMessage] = useState("");
  const [votes, setVotes] = useState<Record<string, boolean>>({});
  const [takingRowIndex, setTakingRowIndex] = useState(-1);
  const [turnDeadline, setTurnDeadline] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  
  // Lobby Config State
  const [hostConfig, setHostConfig] = useState({ totalPlayers: 4, localHumans: 1, turnDuration: 20 });

  // UI State
  const [isScoreBoardOpen, setIsScoreBoardOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  
  // Refs for Logic Optimization
  const thinkingBotsRef = useRef<Set<string>>(new Set());
  
  // Reference to latest state for Event Handlers (to avoid dependency loops)
  const gameStateRef = useRef<GameState>({
      players: [], rows: [], phase: GamePhase.LOBBY, currentRound: 1, activePlayerId: null,
      turnCards: [], resolvingIndex: -1, userMessage: "", votes: {}, takingRowIndex: -1,
      turnDeadline: 0, chatMessages: []
  });

  // Ref for Host Config
  const hostConfigRef = useRef(hostConfig);

  const [myPlayerId, setMyPlayerId] = useState<string>(() => {
      const saved = localStorage.getItem('cow_king_pid');
      return saved || "";
  });
  const [networkMode, setNetworkMode] = useState<NetworkMode>(NetworkMode.LOCAL);
  const [roomId, setRoomId] = useState<string>("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [myName, setMyName] = useState("Player 1");

  // --- Helpers ---
  
  const getMyPlayer = () => players.find(p => p.id === myPlayerId);

  // Persist ID
  useEffect(() => {
      if (myPlayerId) localStorage.setItem('cow_king_pid', myPlayerId);
  }, [myPlayerId]);

  // Sync Refs with State
  useEffect(() => {
      gameStateRef.current = {
          players, rows, phase, currentRound, activePlayerId, turnCards,
          resolvingIndex, userMessage, votes, takingRowIndex, turnDeadline, chatMessages
      };
  }, [players, rows, phase, currentRound, activePlayerId, turnCards, resolvingIndex, userMessage, votes, takingRowIndex, turnDeadline, chatMessages]);

  // Sync Config Ref
  useEffect(() => {
      hostConfigRef.current = hostConfig;
  }, [hostConfig]);

  // --- Game Logic ---

  const initGame = () => {
    setPhase(GamePhase.LOBBY);
    setPlayers([]);
    setNetworkMode(NetworkMode.LOCAL);
    thinkingBotsRef.current.clear();
  };

  useEffect(() => {
    initGame();
  }, []);

  // --- UI Countdown Timer ---
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    if (turnDeadline > 0 && (phase === GamePhase.PLAYER_CHOICE || phase === GamePhase.CHOOSING_ROW)) {
      const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, Math.ceil((turnDeadline - now) / 1000));
        setTimeLeft(remaining);
      };
      
      updateTimer();
      interval = setInterval(updateTimer, 200);
    } else {
      setTimeLeft(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [turnDeadline, phase]);

  const startRound = (
      inputPlayers: Player[] = players, 
      config = hostConfig
  ) => {
    let currentPlayers = [...inputPlayers];
    const totalNeeded = config.totalPlayers;
    
    // INITIALIZE PLAYERS only if this is the start of a game or players array is empty/incomplete
    const needsInitialization = currentPlayers.length === 0 || (networkMode === NetworkMode.HOST && currentPlayers.length < totalNeeded && currentRound === 1);

    if (needsInitialization) {
        if (networkMode === NetworkMode.LOCAL) {
            const humansNeeded = Math.min(config.localHumans, totalNeeded);
            const botsNeeded = totalNeeded - humansNeeded;
            currentPlayers = [];
            
            for(let i=0; i<humansNeeded; i++) {
                currentPlayers.push({
                    id: i===0 ? myPlayerId || 'p1' : `p${i+1}`,
                    name: i===0 ? myName : `Player ${i+1}`,
                    type: PlayerType.HUMAN,
                    hand: [], collectedCards: [], scoreHistory: [], totalScore: 0, selectedCard: null, isReady: false
                });
            }
            for(let i=0; i<botsNeeded; i++) {
                currentPlayers.push({
                    id: `bot-${i}`,
                    name: `Bot ${i+1}`,
                    type: PlayerType.BOT,
                    hand: [], collectedCards: [], scoreHistory: [], totalScore: 0, selectedCard: null, isReady: false
                });
            }
        } else if (networkMode === NetworkMode.HOST) {
            // Host Online: Fill remaining slots with bots if needed
            const existingCount = currentPlayers.length;
            const botsNeeded = Math.max(0, totalNeeded - existingCount);
            for(let i=0; i<botsNeeded; i++) {
                currentPlayers.push({
                    id: `bot-${Date.now()}-${i}`,
                    name: `Bot ${i+1}`,
                    type: PlayerType.BOT,
                    hand: [], collectedCards: [], scoreHistory: [], totalScore: 0, selectedCard: null, isReady: false
                });
            }
        }
    }

    const deck = shuffleDeck(generateDeck());
    
    // PRESERVE SCORES: Map over currentPlayers and only reset round-specific data
    const newPlayers = currentPlayers.map(p => ({
      ...p,
      hand: deck.splice(0, HAND_SIZE).sort((a, b) => a.id - b.id),
      collectedCards: [], // Clear collected for new round
      selectedCard: null,
      isReady: false
      // NOTE: scoreHistory and totalScore are PRESERVED here
    }));

    const newRows: GameRow[] = [];
    for (let i = 0; i < 4; i++) {
      newRows.push({ cards: [deck.shift()!] });
    }

    setPlayers(newPlayers);
    setRows(newRows);
    setTurnCards([]);
    setResolvingIndex(-1);
    setPhase(GamePhase.PLAYER_CHOICE);
    setIsScoreBoardOpen(false);
    setVotes({});
    setTurnDeadline(config.turnDuration > 0 ? Date.now() + (config.turnDuration * 1000) : 0); 
    thinkingBotsRef.current.clear();
    
    audioService.playFanfare();
    
    if (networkMode === NetworkMode.HOST) {
       syncState(newPlayers, newRows, GamePhase.PLAYER_CHOICE);
    }
  };

  const handleCardSelect = (card: CardData) => {
    if (phase !== GamePhase.PLAYER_CHOICE) return;
    const me = getMyPlayer();
    if (!me || me.isReady) return;

    const updatedPlayers = players.map(p => 
      p.id === myPlayerId ? { ...p, selectedCard: card } : p
    );
    setPlayers(updatedPlayers);
    audioService.playSelect();
  };

  const confirmSelection = () => {
     const me = getMyPlayer();
     if (!me || !me.selectedCard) return;

     const updatedPlayers = players.map(p => 
        p.id === myPlayerId ? { ...p, isReady: true } : p
     );
     setPlayers(updatedPlayers);
     audioService.playClick();

     if (networkMode === NetworkMode.LOCAL) {
        checkAllPlayersSelected(updatedPlayers);
     } else if (networkMode === NetworkMode.CLIENT) {
        firebaseService.sendAction(roomId, {
            type: 'ACTION_SELECT_CARD',
            payload: { card: me.selectedCard, playerId: myPlayerId }
        });
     } else if (networkMode === NetworkMode.HOST) {
        checkAllPlayersSelected(updatedPlayers);
        syncState(updatedPlayers);
     }
  };

  const cancelSelection = () => {
      const me = getMyPlayer();
      if (!me || me.isReady) return;
      
      const updatedPlayers = players.map(p => 
          p.id === myPlayerId ? { ...p, selectedCard: null } : p
      );
      setPlayers(updatedPlayers);
  };

  const checkAllPlayersSelected = (currentPlayers: Player[], currentRows: GameRow[] = rows) => {
    const allSelected = currentPlayers.every(p => !!p.selectedCard && p.isReady);
    if (allSelected) {
       revealCards(currentPlayers, currentRows);
    }
  };

  const revealCards = async (currentPlayers: Player[], currentRows: GameRow[] = rows) => {
    setPhase(GamePhase.REVEAL);
    setTurnDeadline(0); 
    thinkingBotsRef.current.clear();
    audioService.playAlert();

    const turns = currentPlayers.map(p => ({
      playerId: p.id,
      card: p.selectedCard!
    })).sort((a, b) => a.card.id - b.card.id);

    setTurnCards(turns);
    
    const playersWithoutCards = currentPlayers.map(p => ({
      ...p,
      hand: p.hand.filter(c => c.id !== p.selectedCard!.id),
      selectedCard: null,
      isReady: false
    }));
    setPlayers(playersWithoutCards);

    if (networkMode === NetworkMode.HOST) {
       // PASS currentRows explicitly to avoid stale state
       syncState(playersWithoutCards, currentRows, GamePhase.REVEAL, turns);
    }

    setTimeout(() => {
      startResolving(turns, playersWithoutCards);
    }, 2000);
  };

  const startResolving = (turns: {playerId: string, card: CardData}[], currentPlayers: Player[]) => {
    setPhase(GamePhase.RESOLVING);
    setResolvingIndex(0);
    processNextTurn(0, turns, rows, currentPlayers);
  };

  const processNextTurn = async (
    index: number, 
    turns: {playerId: string, card: CardData}[], 
    currentRows: GameRow[], 
    currentPlayers: Player[]
  ) => {
    if (index >= turns.length) {
      if (currentPlayers[0].hand.length === 0) {
        calculateScoresAndNextRound(currentPlayers, currentRows);
      } else {
        setPhase(GamePhase.PLAYER_CHOICE);
        setTurnCards([]);
        setResolvingIndex(-1);
        setTurnDeadline(hostConfig.turnDuration > 0 ? Date.now() + (hostConfig.turnDuration * 1000) : 0);
        thinkingBotsRef.current.clear();
        if (networkMode === NetworkMode.HOST) {
            syncState(currentPlayers, currentRows, GamePhase.PLAYER_CHOICE);
        }
      }
      return;
    }

    setResolvingIndex(index);
    const turn = turns[index];
    const card = turn.card;
    const rowIndex = findTargetRowIndex(card, currentRows);

    if (networkMode === NetworkMode.HOST) {
       syncState(currentPlayers, currentRows, GamePhase.RESOLVING, turns, index);
    }

    if (rowIndex !== -1) {
      const targetRow = currentRows[rowIndex];
      
      if (targetRow.cards.length >= 5) {
        setActivePlayerId(turn.playerId);
        await animateTakingRow(rowIndex, turn.playerId, currentPlayers, currentRows);
        
        const updatedPlayers = [...currentPlayers];
        const playerIdx = updatedPlayers.findIndex(p => p.id === turn.playerId);
        updatedPlayers[playerIdx].collectedCards = [
          ...updatedPlayers[playerIdx].collectedCards,
          ...targetRow.cards
        ];

        const updatedRows = [...currentRows];
        updatedRows[rowIndex] = { cards: [card] };

        setPlayers(updatedPlayers);
        setRows(updatedRows);
        audioService.playCardSlide();

        setTimeout(() => processNextTurn(index + 1, turns, updatedRows, updatedPlayers), 1000);

      } else {
        const updatedRows = [...currentRows];
        updatedRows[rowIndex] = { cards: [...targetRow.cards, card] };
        
        setRows(updatedRows);
        audioService.playCardSlide();

        setTimeout(() => processNextTurn(index + 1, turns, updatedRows, currentPlayers), 1000);
      }
    } else {
      // Card too low -> Choose Row
      setActivePlayerId(turn.playerId);
      setPhase(GamePhase.CHOOSING_ROW);
      setTurnDeadline(hostConfig.turnDuration > 0 ? Date.now() + (hostConfig.turnDuration * 1000) : 0);
      audioService.playAlert();
      
      if (networkMode === NetworkMode.HOST) {
          syncState(currentPlayers, currentRows, GamePhase.CHOOSING_ROW, turns, index, turn.playerId);
      }

      const player = currentPlayers.find(p => p.id === turn.playerId);
      if (player && player.type === PlayerType.BOT && networkMode !== NetworkMode.CLIENT) {
        const chosenRowIndex = await getBotRowChoice(player, currentRows);
        setTimeout(() => {
          handleRowSelect(chosenRowIndex, currentPlayers, currentRows, turns, index);
        }, 1500);
      }
    }
  };

  const handleRowSelect = async (
    rowIndex: number, 
    currentPlayers: Player[] = players,
    currentRows: GameRow[] = rows,
    currentTurns: {playerId: string, card: CardData}[] = turnCards,
    currentIndex: number = resolvingIndex
  ) => {
    const turn = currentTurns[currentIndex];
    if (!turn) return;

    setTurnDeadline(0);

    await animateTakingRow(rowIndex, turn.playerId, currentPlayers, currentRows);

    const updatedPlayers = [...currentPlayers];
    const playerIdx = updatedPlayers.findIndex(p => p.id === turn.playerId);
    updatedPlayers[playerIdx].collectedCards = [
      ...updatedPlayers[playerIdx].collectedCards,
      ...currentRows[rowIndex].cards
    ];

    const updatedRows = [...currentRows];
    updatedRows[rowIndex] = { cards: [turn.card] };

    setPlayers(updatedPlayers);
    setRows(updatedRows);
    setPhase(GamePhase.RESOLVING);
    setTakingRowIndex(-1);
    setActivePlayerId(null);

    setTimeout(() => processNextTurn(currentIndex + 1, currentTurns, updatedRows, updatedPlayers), 1000);
  };

  const onUserSelectRow = (rowIndex: number) => {
    if (phase !== GamePhase.CHOOSING_ROW) return;
    if (activePlayerId !== myPlayerId) return;

    if (networkMode === NetworkMode.LOCAL) {
      handleRowSelect(rowIndex);
    } else if (networkMode === NetworkMode.CLIENT) {
      firebaseService.sendAction(roomId, {
         type: 'ACTION_SELECT_ROW',
         payload: { rowIndex, playerId: myPlayerId }
      });
    }
  };

  const animateTakingRow = (rowIndex: number, playerId: string, currentPlayers: Player[], currentRows: GameRow[]) => {
    return new Promise<void>(resolve => {
      setTakingRowIndex(rowIndex);
      const player = currentPlayers.find(p => p.id === playerId);
      setUserMessage(`${player?.name} takes Row ${rowIndex + 1}!`);
      audioService.playTakeRow();
      setTimeout(() => {
        setTakingRowIndex(-1);
        setUserMessage("");
        resolve();
      }, 1500);
    });
  };

  const calculateScoresAndNextRound = (currentPlayers: Player[] = players, currentRows: GameRow[] = rows) => {
    const playersWithScores = currentPlayers.map(p => {
      const roundScore = calculateRoundScore(p, currentPlayers);
      const collected = p.collectedCards || [];
      return {
        ...p,
        scoreHistory: [...(p.scoreHistory || []), { score: roundScore, heads: collected.reduce((s, c) => s + c.bullHeads, 0) }],
        totalScore: p.totalScore + roundScore
      };
    });

    setPlayers(playersWithScores);
    setIsScoreBoardOpen(true);
    setPhase(GamePhase.ROUND_VOTING); 
    setVotes({});
    setTurnDeadline(0); 
    
    if (networkMode === NetworkMode.HOST) {
        syncState(playersWithScores, currentRows, GamePhase.ROUND_VOTING);
    }
  };
  
  const handleVoteNext = (vote: boolean) => {
    const newVotes = { ...votes, [myPlayerId]: vote };
    setVotes(newVotes);
    
    if (networkMode === NetworkMode.LOCAL) {
        if (vote) {
            setCurrentRound(r => r + 1);
            startRound();
        } else {
            setPhase(GamePhase.GAME_END);
            setIsScoreBoardOpen(true);
        }
    } else if (networkMode === NetworkMode.CLIENT) {
        firebaseService.sendAction(roomId, {
            type: 'ACTION_VOTE_NEXT_ROUND',
            payload: { vote, playerId: myPlayerId }
        });
    }
  };

  const handleSendReaction = (content: string, type: 'text' | 'emoji') => {
    if (!myPlayerId) return;
    
    const newMsg: ChatMessage = {
      id: Math.random().toString(),
      playerId: myPlayerId,
      playerName: myName,
      content,
      type,
      timestamp: Date.now()
    };
    
    const updatedMessages = [...chatMessages, newMsg].slice(-7);
    setChatMessages(updatedMessages);
    setIsChatOpen(false);

    if (networkMode === NetworkMode.CLIENT) {
        firebaseService.sendAction(roomId, {
            type: 'ACTION_SEND_REACTION',
            payload: { content, type, playerId: myPlayerId }
        });
    } else if (networkMode === NetworkMode.HOST) {
        syncState(players, rows, phase, turnCards, resolvingIndex, activePlayerId, updatedMessages);
    }
  };

  // --- Timer Enforcement (Host Only) ---
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return; 
    if (turnDeadline <= 0) return;

    const checkTimer = setInterval(() => {
        if (Date.now() > turnDeadline) {
            setTurnDeadline(0); 

            // Use REF for current state to avoid stale closures
            const currentPlayers = gameStateRef.current.players;
            const currentPhase = gameStateRef.current.phase;

            if (currentPhase === GamePhase.PLAYER_CHOICE) {
                setPlayers(prev => {
                   let changed = false;
                   const updated = prev.map(p => {
                       if (!p.isReady) {
                           const cardToPlay = p.selectedCard || p.hand[Math.floor(Math.random() * p.hand.length)];
                           changed = true;
                           return { ...p, selectedCard: cardToPlay, isReady: true };
                       }
                       return p;
                   });
                   if (changed) {
                       // Use fresh rows from ref
                       checkAllPlayersSelected(updated, gameStateRef.current.rows);
                       if (networkMode === NetworkMode.HOST) syncState(updated, gameStateRef.current.rows);
                   }
                   return updated;
                });
            } 
            else if (currentPhase === GamePhase.CHOOSING_ROW) {
                const randomRowIndex = Math.floor(Math.random() * 4);
                handleRowSelect(randomRowIndex);
            }
        }
    }, 1000);
    return () => clearInterval(checkTimer);
  }, [turnDeadline, phase, networkMode]);

  // --- Bot AI Loop ---
  useEffect(() => {
    if (networkMode === NetworkMode.CLIENT) return;

    if (phase === GamePhase.PLAYER_CHOICE) {
        const botsToMove = players.filter(p => 
            p.type === PlayerType.BOT && !p.isReady && !thinkingBotsRef.current.has(p.id)
        );
        if (botsToMove.length === 0) return;

        botsToMove.forEach(async (bot) => {
            thinkingBotsRef.current.add(bot.id);
            await new Promise(r => setTimeout(r, Math.random() * 1000 + 200));
            const card = await getBotDecision(bot, rows, []);
            setPlayers(prev => {
                const idx = prev.findIndex(p => p.id === bot.id);
                if (idx === -1 || prev[idx].isReady) return prev;
                const newPlayers = [...prev];
                newPlayers[idx] = { ...newPlayers[idx], selectedCard: card, isReady: true };
                
                if (networkMode === NetworkMode.LOCAL || networkMode === NetworkMode.HOST) {
                    // Use fresh rows ref to avoid syncing stale state
                    checkAllPlayersSelected(newPlayers, gameStateRef.current.rows);
                }
                return newPlayers;
            });
        });
    }
  }, [phase, players, rows, networkMode]);

  // --- Networking ---
  
  const syncState = (
      p: Player[] = players, 
      r: GameRow[] = rows, 
      ph: GamePhase = phase,
      tc: {playerId: string, card: CardData}[] = turnCards,
      ri: number = resolvingIndex,
      ap: string | null = activePlayerId,
      msgs: ChatMessage[] = chatMessages
  ) => {
      const state: GameState = {
          players: p, rows: r, phase: ph, currentRound, 
          activePlayerId: ap, turnCards: tc, resolvingIndex: ri,
          userMessage, votes, takingRowIndex, turnDeadline, chatMessages: msgs
      };
      firebaseService.updateGameState(roomId, state);
  };

  // Host Logic - FIXED to use fresh state from ref
  useEffect(() => {
    if (networkMode === NetworkMode.HOST && roomId) {
        const unsubscribe = firebaseService.subscribeToActions(roomId, (msg) => {
            // Get fresh state from Ref
            const cur = gameStateRef.current;
            const curConfig = hostConfigRef.current;
            
            if (msg.type === 'ACTION_SELECT_CARD') {
                setPlayers(prev => {
                    const updated = prev.map(p => p.id === msg.payload.playerId ? { ...p, selectedCard: msg.payload.card, isReady: true } : p);
                    // PASS FRESH ROWS explicitly
                    checkAllPlayersSelected(updated, cur.rows);
                    return updated;
                });
            } else if (msg.type === 'ACTION_SELECT_ROW') {
                // PASS FRESH STATE explicitly to handle logic
                handleRowSelect(
                    msg.payload.rowIndex, 
                    cur.players, 
                    cur.rows, 
                    cur.turnCards, 
                    cur.resolvingIndex
                );
            } else if (msg.type === 'ACTION_VOTE_NEXT_ROUND') {
                setVotes(prev => {
                   const newVotes = { ...prev, [msg.payload.playerId]: msg.payload.vote };
                   
                   // ANY NO -> GAME END
                   if (msg.payload.vote === false) {
                       setPhase(GamePhase.GAME_END);
                       syncState(cur.players, cur.rows, GamePhase.GAME_END);
                       setIsScoreBoardOpen(true);
                       return newVotes;
                   }

                   // ALL YES -> NEXT ROUND
                   const humans = cur.players.filter(p => p.type === PlayerType.HUMAN);
                   // Check if all humans have voted (and implicitly YES because we filter NO above)
                   if (humans.every(h => newVotes[h.id] === true)) {
                       setCurrentRound(r => r + 1);
                       // PASS FRESH PLAYERS AND CONFIG to avoid resetting to initial state
                       startRound(cur.players, curConfig);
                   }
                   return newVotes;
                });
            } else if (msg.type === 'ACTION_SEND_REACTION') {
                const newMsg: ChatMessage = {
                    id: Math.random().toString(),
                    playerId: msg.payload.playerId,
                    playerName: cur.players.find(p => p.id === msg.payload.playerId)?.name || 'Unknown',
                    content: msg.payload.content,
                    type: msg.payload.type,
                    timestamp: Date.now()
                };
                const updated = [...cur.chatMessages, newMsg].slice(-7);
                setChatMessages(updated);
                syncState(cur.players, cur.rows, cur.phase, cur.turnCards, cur.resolvingIndex, cur.activePlayerId, updated);
            } else if (msg.type === 'PLAYER_JOINED') {
                setPlayers(prev => {
                    if (prev.some(p => p.id === msg.payload.id)) return prev;
                    return [...prev, {
                        id: msg.payload.id,
                        name: msg.payload.name,
                        type: PlayerType.HUMAN,
                        hand: [], collectedCards: [], scoreHistory: [], totalScore: 0, selectedCard: null, isReady: false
                    }];
                });
            }
        });
        
        return () => unsubscribe();
    }
  }, [networkMode, roomId]);

  // Client Logic
  useEffect(() => {
      if (networkMode === NetworkMode.CLIENT && roomId) {
          firebaseService.subscribeToGameState(roomId, (state) => {
              setPlayers(state.players || []);
              setRows(state.rows || []);
              setPhase(state.phase);
              setCurrentRound(state.currentRound);
              setActivePlayerId(state.activePlayerId);
              setTurnCards(state.turnCards || []);
              setResolvingIndex(state.resolvingIndex);
              setTakingRowIndex(state.takingRowIndex);
              setTurnDeadline(state.turnDeadline || 0);
              setChatMessages(state.chatMessages || []);
              
              if (state.phase === GamePhase.ROUND_VOTING || state.phase === GamePhase.GAME_END) setIsScoreBoardOpen(true);
              else if (state.phase === GamePhase.PLAYER_CHOICE) setIsScoreBoardOpen(false);
          });
      }
  }, [networkMode, roomId]);


  // --- Render ---

  if (phase === GamePhase.LOBBY) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
         <div className="flex flex-col md:flex-row gap-6 w-full max-w-4xl">
             {/* Left: Local Game */}
             <div className="flex-1 bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                 <h2 className="text-2xl font-bold text-emerald-400 mb-4 flex items-center gap-2">
                     <PlayCircle /> Local / Solo
                 </h2>
                 
                 {/* NAME INPUT */}
                 <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                        <User size={14}/> Your Name
                    </label>
                    <input 
                        className="w-full bg-slate-900 border border-slate-600 text-white p-3 rounded-lg focus:border-emerald-500 focus:outline-none"
                        value={myName}
                        onChange={(e) => setMyName(e.target.value)}
                        placeholder="Enter your name"
                    />
                 </div>

                 <div className="space-y-4">
                     <div>
                         <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Total Players</label>
                         <select 
                            className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded"
                            value={hostConfig.totalPlayers}
                            onChange={(e) => setHostConfig({...hostConfig, totalPlayers: Number(e.target.value)})}
                         >
                             {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} Players</option>)}
                         </select>
                     </div>
                     <div>
                         <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Human Players</label>
                         <select 
                            className="w-full bg-slate-900 border border-slate-700 text-white p-2 rounded"
                            value={hostConfig.localHumans}
                            onChange={(e) => setHostConfig({...hostConfig, localHumans: Number(e.target.value)})}
                         >
                             {Array.from({length: hostConfig.totalPlayers}, (_, i) => i + 1).map(n => 
                                 <option key={n} value={n}>{n} Human{n>1?'s':''}</option>
                             )}
                         </select>
                     </div>
                     <div className="text-sm text-slate-400 pt-2">
                         Bots: <span className="text-white font-bold">{Math.max(0, hostConfig.totalPlayers - hostConfig.localHumans)}</span>
                     </div>
                     <button 
                         onClick={() => {
                             setMyPlayerId('p1');
                             startRound();
                         }}
                         className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg mt-4"
                     >
                         Start Local Game
                     </button>
                 </div>
             </div>

             {/* Right: Online Game */}
             <div className="flex-1 bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700">
                 <h2 className="text-2xl font-bold text-blue-400 mb-4 flex items-center gap-2">
                     <Users /> Online Multiplayer
                 </h2>
                 
                 {!roomId ? (
                     <div className="space-y-6">
                         
                         {/* NAME INPUT */}
                         <div className="mb-2">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                                <User size={14}/> Your Name
                            </label>
                            <input 
                                className="w-full bg-slate-900 border border-slate-600 text-white p-3 rounded-lg focus:border-blue-500 focus:outline-none"
                                value={myName}
                                onChange={(e) => setMyName(e.target.value)}
                                placeholder="Enter your name"
                            />
                         </div>

                         <div className="p-4 bg-slate-900 rounded-lg border border-slate-700">
                             <h3 className="text-white font-bold mb-2">Create Room</h3>
                             <div className="flex gap-4 mb-3">
                               <div className="flex-1">
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Total Slots</label>
                                  <select 
                                      className="w-full bg-slate-800 border border-slate-600 text-white p-2 rounded"
                                      value={hostConfig.totalPlayers}
                                      onChange={(e) => setHostConfig({...hostConfig, totalPlayers: Number(e.target.value)})}
                                  >
                                      {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n} Players</option>)}
                                  </select>
                               </div>
                               <div className="flex-1">
                                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Turn Timer</label>
                                  <select 
                                      className="w-full bg-slate-800 border border-slate-600 text-white p-2 rounded"
                                      value={hostConfig.turnDuration}
                                      onChange={(e) => setHostConfig({...hostConfig, turnDuration: Number(e.target.value)})}
                                  >
                                      <option value={10}>10s Fast</option>
                                      <option value={20}>20s Normal</option>
                                      <option value={30}>30s Slow</option>
                                      <option value={60}>60s Relaxed</option>
                                      <option value={0}>Unlimited</option>
                                  </select>
                               </div>
                             </div>
                             <button 
                                 onClick={async () => {
                                     const id = await firebaseService.createRoom();
                                     setRoomId(id);
                                     setNetworkMode(NetworkMode.HOST);
                                     setMyPlayerId('host');
                                     setPlayers([{ id: 'host', name: myName, type: PlayerType.HUMAN, hand: [], collectedCards: [], scoreHistory: [], totalScore: 0, selectedCard: null, isReady: false }]);
                                 }}
                                 className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded"
                             >
                                 Create as Host
                             </button>
                         </div>

                         <div className="p-4 bg-slate-900 rounded-lg border border-slate-700">
                             <h3 className="text-white font-bold mb-2">Join Room</h3>
                             <div className="flex gap-2">
                                <input 
                                    className="flex-1 bg-slate-800 border border-slate-600 text-white p-2 rounded uppercase font-mono"
                                    placeholder="1234"
                                    value={joinRoomId}
                                    onChange={(e) => setJoinRoomId(e.target.value)}
                                />
                                <button 
                                    onClick={async () => {
                                        const success = await firebaseService.joinRoom(joinRoomId);
                                        if (success) {
                                            setRoomId(joinRoomId);
                                            setNetworkMode(NetworkMode.CLIENT);
                                            let pid = localStorage.getItem('cow_king_pid');
                                            if (!pid || pid === 'host') {
                                                pid = 'p-' + Math.floor(Math.random() * 10000);
                                                setMyPlayerId(pid);
                                            } else {
                                                setMyPlayerId(pid);
                                            }
                                            firebaseService.sendAction(joinRoomId, { type: 'PLAYER_JOINED', payload: { id: pid, name: myName } });
                                        } else {
                                            alert("Room not found!");
                                        }
                                    }}
                                    className="px-4 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded"
                                >
                                    Join
                                </button>
                             </div>
                         </div>
                     </div>
                 ) : (
                     // Host Lobby View
                     <div className="text-center space-y-4">
                         <div className="text-4xl font-mono text-yellow-400 font-black tracking-widest mb-2">{roomId}</div>
                         <p className="text-slate-400 text-sm">Share this ID with friends</p>
                         
                         <div className="bg-slate-900 p-4 rounded-lg text-left max-h-48 overflow-y-auto">
                             <div className="flex justify-between text-xs text-slate-500 uppercase font-bold mb-2">
                                 <span>Players ({players.length}/{hostConfig.totalPlayers})</span>
                                 <span>Bots: {Math.max(0, hostConfig.totalPlayers - players.length)}</span>
                             </div>
                             <div className="space-y-1">
                                 {players.map(p => (
                                     <div key={p.id} className="flex items-center gap-2">
                                         <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                         <span className="text-white">{p.name}</span>
                                         {p.id === myPlayerId && <span className="text-xs text-slate-500">(You)</span>}
                                     </div>
                                 ))}
                             </div>
                         </div>

                         {networkMode === NetworkMode.HOST && (
                             <button 
                                 onClick={() => startRound()}
                                 className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-lg animate-pulse"
                             >
                                 Start Game
                             </button>
                         )}
                         <div className="text-xs text-slate-500">
                             Waiting for host to start...
                         </div>
                     </div>
                 )}
             </div>
         </div>
         
         <div className="fixed bottom-4 text-slate-600 text-xs">
             Your Name: 
             <input 
                className="bg-transparent border-b border-slate-600 text-slate-400 ml-2 focus:outline-none focus:border-slate-400"
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
             />
         </div>
      </div>
    );
  }

  // --- Main Game UI ---

  const myPlayer = getMyPlayer();
  
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-yellow-500/30 flex flex-col overflow-hidden">
       
       {/* Chat Overlay (RIGHT SIDE) */}
       <div className="fixed top-32 right-4 z-40 flex flex-col gap-2 w-64 pointer-events-none items-end">
           {chatMessages.map(msg => (
               <div key={msg.id} className="animate-in slide-in-from-right fade-in duration-300 flex flex-col items-end">
                   <div className={`
                       px-4 py-2 rounded-2xl shadow-lg backdrop-blur-sm border border-white/10 text-right
                       ${msg.type === 'emoji' ? 'bg-transparent text-4xl border-none p-0' : 'bg-black/60 text-white text-sm'}
                   `}>
                       <span className="text-[10px] text-yellow-500 font-bold block mb-0.5 opacity-80">{msg.playerName}</span>
                       {msg.content}
                   </div>
               </div>
           ))}
       </div>

       {/* Header */}
       <header className="h-14 sm:h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-20 relative">
          <div className="flex items-center gap-2 sm:gap-4">
             <div className="text-yellow-500 font-black text-xl tracking-tighter hidden sm:block">牛頭王 - 遠離賭博</div>
             <div className="bg-slate-800 px-3 py-1 rounded-full text-xs font-mono text-slate-400 border border-slate-700 flex items-center gap-2">
                <span>R {currentRound}</span>
                {turnDeadline === 0 && phase === GamePhase.PLAYER_CHOICE && (
                    <span className="text-blue-400 flex items-center gap-1 font-bold"><Clock size={12}/> ∞</span>
                )}
             </div>
          </div>
          
          <div className="flex items-center gap-2">
             <button onClick={() => setIsScoreBoardOpen(true)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition">
                <Trophy size={20} />
             </button>
             <button onClick={() => {
                 const m = audioService.toggleMute();
                 setIsMuted(m);
             }} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white transition">
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
             </button>
             <button onClick={() => window.location.reload()} className="p-2 hover:bg-red-900/30 text-red-400 rounded-full transition">
                <LogOut size={20} />
             </button>
          </div>
          
          {/* BIG TIMER (Positioned Top Left) */}
          {turnDeadline > 0 && (phase === GamePhase.PLAYER_CHOICE || phase === GamePhase.CHOOSING_ROW) && (
              <div className="absolute top-16 left-4 z-40 pointer-events-none">
                 <div className={`
                    flex flex-col items-center justify-center px-6 py-2 rounded-xl shadow-2xl border-2 backdrop-blur-xl transition-all duration-300
                    ${timeLeft < 5 
                        ? 'bg-red-600/90 border-red-400 text-white animate-pulse scale-110' 
                        : 'bg-slate-900/90 border-emerald-500 text-emerald-400'}
                 `}>
                    <div className="flex items-center gap-2">
                        <AlarmClock size={24} className={timeLeft < 5 ? 'animate-bounce' : ''} />
                        <span className="text-3xl font-black font-mono tracking-widest filter drop-shadow-lg">
                            {timeLeft}s
                        </span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">
                        {phase === GamePhase.CHOOSING_ROW ? 'Pick Row!' : 'Pick Card'}
                    </span>
                 </div>
              </div>
          )}
       </header>

       {/* Main Board Area */}
       <main className="flex-1 relative overflow-hidden flex flex-col">
          <GameBoard 
             rows={rows}
             phase={phase}
             takingRowIndex={takingRowIndex}
             turnCards={turnCards}
             resolvingIndex={resolvingIndex}
             players={players}
             onSelectRow={onUserSelectRow}
             isMyTurnToChooseRow={activePlayerId === myPlayerId && phase === GamePhase.CHOOSING_ROW}
             choosingPlayerName={players.find(p => p.id === activePlayerId)?.name}
             myPlayerId={myPlayerId}
          />

          {/* Hand Area */}
          <div className="relative z-30 bg-slate-900/80 backdrop-blur-md border-t border-slate-800 pt-10 pb-4 sm:pb-6 transition-all duration-300">
             {/* CONFIRM BUTTON OVERLAY */}
             {myPlayer?.selectedCard && !myPlayer?.isReady && (
                 <div className="absolute top-[-3.5rem] left-1/2 -translate-x-1/2 flex gap-2 animate-in zoom-in-90 duration-200">
                     <button 
                         onClick={confirmSelection}
                         className="bg-emerald-500 hover:bg-emerald-400 text-white font-bold py-2 px-6 rounded-full shadow-lg shadow-emerald-500/20 flex items-center gap-2 active:scale-95 transition-transform"
                     >
                         <Check size={18} strokeWidth={3} /> CONFIRM
                     </button>
                     <button 
                         onClick={cancelSelection}
                         className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-2 px-4 rounded-full shadow-lg flex items-center gap-2 active:scale-95 transition-transform"
                     >
                         <RefreshCcw size={18} />
                     </button>
                 </div>
             )}
             
             {/* Waiting Indicator */}
             {myPlayer?.isReady && phase === GamePhase.PLAYER_CHOICE && (
                 <div className="absolute top-[-2.5rem] left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur px-4 py-1 rounded-full text-sm text-emerald-400 font-bold animate-pulse">
                     Card Played. Waiting for others...
                 </div>
             )}

             <div className="max-w-6xl mx-auto px-2 sm:px-4">
                <div className="flex justify-between items-center mb-2 relative">
                   <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Your Hand</span>
                   {/* Chat Toggle */}
                   <div className="absolute -top-6 right-0">
                       <div className="relative">
                           {isChatOpen && (
                               <div className="absolute bottom-12 right-0 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-3 animate-in slide-in-from-bottom-5">
                                   <div className="grid grid-cols-4 gap-2 mb-3 max-h-40 overflow-y-auto no-scrollbar">
                                       {PRESET_REACTIONS.map(r => (
                                           <button 
                                             key={r} 
                                             onClick={() => handleSendReaction(r, r.length > 2 ? 'text' : 'emoji')}
                                             className="p-2 hover:bg-slate-700 rounded text-xl transition-colors"
                                           >
                                             {r}
                                           </button>
                                       ))}
                                   </div>
                                   <div className="flex gap-2">
                                       <input 
                                          className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 text-sm text-white"
                                          placeholder="Say something..."
                                          value={chatInput}
                                          onChange={e => setChatInput(e.target.value)}
                                          onKeyDown={e => e.key === 'Enter' && handleSendReaction(chatInput, 'text')}
                                       />
                                       <button 
                                         onClick={() => handleSendReaction(chatInput, 'text')}
                                         disabled={!chatInput.trim()}
                                         className="p-2 bg-blue-600 hover:bg-blue-500 rounded text-white disabled:opacity-50"
                                       >
                                          <Send size={14}/>
                                       </button>
                                   </div>
                               </div>
                           )}
                           <button 
                               onClick={() => setIsChatOpen(!isChatOpen)}
                               className={`p-3 rounded-full shadow-lg transition-all ${isChatOpen ? 'bg-slate-700 text-white' : 'bg-slate-800 text-blue-400 hover:bg-slate-700'}`}
                           >
                               {isChatOpen ? <X size={20}/> : <MessageSquare size={20}/>}
                           </button>
                       </div>
                   </div>
                </div>
                
                <div className="flex justify-center gap-[-10px] sm:gap-2 overflow-x-auto py-2 px-4 -ml-12 no-scrollbar mask-fade-sides min-h-[120px]">
                   {myPlayer?.hand
                     // Filter out the selected card ONLY if the player is READY (confirmed)
                     .filter(card => !myPlayer.isReady || (myPlayer.selectedCard?.id !== card.id))
                     .map((card) => (
                      <div 
                        key={card.id} 
                        className={`transform transition-all duration-200 
                            ${myPlayer.selectedCard?.id === card.id ? '-translate-y-8 z-20 scale-110' : 'hover:-translate-y-4 hover:z-10 hover:scale-105'}
                            ${phase !== GamePhase.PLAYER_CHOICE ? 'opacity-50 grayscale cursor-not-allowed' : ''}
                        `}
                      >
                         <Card 
                           id={card.id} 
                           bullHeads={card.bullHeads} 
                           onClick={() => handleCardSelect(card)}
                           selected={myPlayer.selectedCard?.id === card.id}
                           disabled={phase !== GamePhase.PLAYER_CHOICE}
                         />
                      </div>
                   ))}
                   {(!myPlayer?.hand || myPlayer.hand.length === 0) && (
                      <div className="text-slate-600 text-sm italic py-8 w-full text-center ml-12">
                         {'No cards left'}
                      </div>
                   )}
                </div>
             </div>
          </div>
       </main>

       {/* Scoreboard Modal */}
       <ScoreBoard 
         isOpen={isScoreBoardOpen} 
         onClose={() => phase !== GamePhase.ROUND_VOTING && setIsScoreBoardOpen(false)} 
         players={players} 
         currentRound={currentRound}
       />

       {/* Voting Overlay */}
       {phase === GamePhase.ROUND_VOTING && (
           <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-10">
               <button 
                 onClick={() => handleVoteNext(true)}
                 disabled={votes[myPlayerId]}
                 className={`
                    px-8 py-3 rounded-full font-bold text-lg shadow-2xl flex items-center gap-2 transition-transform active:scale-95
                    ${votes[myPlayerId] ? 'bg-slate-600 text-slate-400 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-400 text-white'}
                 `}
               >
                  {votes[myPlayerId] ? 'Waiting for others...' : 'Next Round'} <Play size={20} fill="currentColor" />
               </button>
           </div>
       )}
    </div>
  );
}

export default App;
