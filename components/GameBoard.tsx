
import React from 'react';
import { CardData, GameRow, GamePhase, Player } from '../types';
import Card from './Card';
import { MousePointerClick, Skull, ArrowDown, Loader, CheckCircle2 } from 'lucide-react';

interface GameBoardProps {
  rows: GameRow[];
  onSelectRow?: (rowIndex: number) => void;
  phase: GamePhase;
  takingRowIndex?: number;
  turnCards?: {playerId: string, card: CardData}[];
  resolvingIndex?: number;
  players?: Player[];
  isMyTurnToChooseRow?: boolean;
  choosingPlayerName?: string;
  myPlayerId?: string;
}

const GameBoard: React.FC<GameBoardProps> = ({ 
  rows, 
  onSelectRow, 
  phase, 
  takingRowIndex = -1,
  turnCards = [],
  resolvingIndex = -1,
  players = [],
  isMyTurnToChooseRow = false,
  choosingPlayerName = 'Unknown',
  myPlayerId
}) => {
  const isChoosingPhase = phase === GamePhase.CHOOSING_ROW;
  
  // Determine if the local user is allowed to interact with the rows
  const canInteract = isChoosingPhase && isMyTurnToChooseRow;

  // Logic for Staging Area Animation & Display
  // We want to show ALL players in the staging area during Choice/Reveal phases
  const showStaging = phase === GamePhase.PLAYER_CHOICE || phase === GamePhase.REVEAL || phase === GamePhase.RESOLVING || isChoosingPhase;

  // Find target row for the active card (Resolving phase only)
  const activeTurn = (resolvingIndex >= 0 && turnCards && turnCards[resolvingIndex]) ? turnCards[resolvingIndex] : null;
  const activeCard = activeTurn ? activeTurn.card : null;
  const activePlayerId = activeTurn ? activeTurn.playerId : null;

  let targetRowIndex = -1;
  if (activeCard && phase === GamePhase.RESOLVING && rows && rows.length > 0) {
     let maxVal = -1;
     rows.forEach((row, idx) => {
        if (row.cards && row.cards.length > 0) {
          const last = row.cards[row.cards.length - 1];
          if (last && activeCard.id > last.id && last.id > maxVal) {
             maxVal = last.id;
             targetRowIndex = idx;
          }
        }
     });
  }

  if (!rows || rows.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-slate-500 animate-pulse">Initializing Board...</div>;
  }

  return (
    <div className="flex-grow flex flex-col justify-center max-w-7xl mx-auto w-full py-2 sm:py-4 px-4 relative min-h-0">
      
      {/* STAGING AREA: Player Status / Cards */}
      {showStaging && (
        <div className="mb-4 sm:mb-6 min-h-[120px] sm:min-h-[160px] flex justify-center items-center perspective-1000 shrink-0">
          <div className="flex flex-wrap justify-center gap-2 sm:gap-4 w-full px-2">
            {/* CHOICE PHASE: Show all players status (Thinking/Ready) */}
            {phase === GamePhase.PLAYER_CHOICE ? (
               players && players.map(player => {
                 const isLocal = myPlayerId && player.id === myPlayerId;
                 const isReady = player.isReady;
                 
                 return (
                   <div key={player.id} className="flex flex-col items-center relative animate-in fade-in">
                     <div className="relative scale-75 sm:scale-90 origin-bottom">
                        {isReady ? (
                          // Ready: Show Card (Face Up if me, Face Down if other)
                          <div className="relative">
                             <Card 
                               id={player.selectedCard?.id || 0} 
                               bullHeads={player.selectedCard?.bullHeads || 0} 
                               revealed={!!isLocal} // Reveal only if local
                             />
                             {!isLocal && (
                               <div className="absolute -top-2 -right-2 bg-emerald-500 text-white rounded-full p-1 shadow-lg animate-in zoom-in">
                                   <CheckCircle2 size={14} />
                               </div>
                             )}
                          </div>
                        ) : (
                          // Not Ready: Empty Slot
                          <div className="w-20 h-28 sm:w-24 sm:h-36 rounded-lg border-2 border-dashed border-slate-600 bg-slate-800/50 flex items-center justify-center">
                             <Loader className="animate-spin text-slate-500" size={20} />
                          </div>
                        )}
                     </div>
                     <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full max-w-[80px] truncate
                       ${isReady ? 'bg-slate-700 text-emerald-400' : 'bg-slate-800 text-slate-500'}
                     `}>
                       {player.name}
                     </span>
                   </div>
                 );
               })
            ) : (
               // REVEAL / RESOLVING PHASE: Show Turn Cards (Sorted)
               turnCards && turnCards.map((turn, idx) => {
                  if (!turn || !turn.card) return null;

                  const player = players ? players.find(p => p.id === turn.playerId) : null;
                  const isResolving = idx === resolvingIndex;
                  const isDone = idx < resolvingIndex;
                  // const isLocal = myPlayerId && turn.playerId === myPlayerId;
                  
                  // Hide processed cards from staging area (they moved to rows)
                  if (phase === GamePhase.RESOLVING && isDone) return null;

                  let transformStyle = {};
                  // Note: Logic to fly card to row is complex in React without a dedicated animation library.
                  // We simulate it by hiding it here and showing it in the row (logic in processNextTurn).
                  // But for visual flair, we fade it out or scale it.

                  return (
                     <div 
                      key={turn.card.id} 
                      className="flex flex-col items-center transition-all duration-500 relative animate-in fade-in"
                      style={transformStyle}
                     >
                       <div className={`relative transition-transform duration-300 ${isResolving ? 'scale-110 z-20 ring-4 ring-yellow-400 rounded-lg shadow-[0_0_20px_rgba(250,204,21,0.5)]' : 'scale-75 sm:scale-90 opacity-80'}`}>
                          <Card 
                            id={turn.card.id} 
                            bullHeads={turn.card.bullHeads} 
                            revealed={true} // Always revealed in this phase
                            selected={isResolving}
                          />
                          {isResolving && (
                            <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce text-yellow-400">
                              <ArrowDown size={24} fill="currentColor" />
                            </div>
                          )}
                       </div>
                       <span className={`mt-1 text-xs font-bold px-2 py-0.5 rounded-full max-w-[80px] truncate
                         ${isResolving ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-slate-300'}
                       `}>
                         {player?.name || '???'}
                       </span>
                     </div>
                  );
               })
            )}
          </div>
        </div>
      )}

      {/* ROWS GRID - OPTIMIZED FOR DESKTOP (2 COLUMNS) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 md:gap-x-6 md:gap-y-4 w-full auto-rows-fr">
        {rows.map((row, idx) => {
          if (!row || !row.cards) return null;

          const isBeingTaken = takingRowIndex === idx;
          
          let takerName = "SOMEONE";
          if (isBeingTaken && activePlayerId && players) {
            const player = players.find(p => p.id === activePlayerId);
            if (player) takerName = player.name.toUpperCase();
          }

          return (
            <div 
              key={idx} 
              className={`
                relative flex items-center p-2 sm:p-3 rounded-lg transition-all duration-500 min-h-[100px] sm:min-h-[120px]
                ${isBeingTaken 
                  ? 'bg-red-900/80 border-4 border-red-500 scale-[1.02] shadow-[0_0_30px_rgba(239,68,68,0.6)] z-10' 
                  : canInteract 
                    ? 'bg-yellow-900/40 hover:bg-yellow-600/40 cursor-pointer ring-4 ring-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)] scale-[1.01]' 
                    : 'bg-emerald-900/50 border border-slate-700/50'
                }
              `}
              onClick={() => {
                if (canInteract && onSelectRow) {
                  onSelectRow(idx);
                }
              }}
            >
              <div className={`
                absolute -left-2 sm:-left-3 w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center rounded-full font-bold text-xs sm:text-sm shadow-lg z-20
                ${isBeingTaken ? 'bg-red-500 text-white animate-ping' : 'bg-slate-700 text-slate-200 border-2 border-slate-600'}
              `}>
                {idx + 1}
              </div>

              <div className="flex flex-wrap gap-1 sm:gap-2 pl-3 sm:pl-4">
                {row.cards.map((card) => (
                  card ? (
                    <div key={card.id} className={`${isBeingTaken ? 'animate-pulse scale-95 brightness-75 transition-all' : ''}`}>
                      <Card 
                        id={card.id} 
                        bullHeads={card.bullHeads} 
                        small={true}
                        revealed={true}
                      />
                    </div>
                  ) : null
                ))}
              </div>

              {isBeingTaken && (
                 <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20 backdrop-blur-[2px] rounded-lg">
                    <div className="bg-red-600 text-white font-black text-lg sm:text-xl px-4 py-2 rounded-full shadow-2xl animate-bounce flex items-center gap-2 border-4 border-red-400">
                      <Skull size={24} /> 
                      {takerName} TAKING!
                    </div>
                 </div>
              )}

              {canInteract && !isBeingTaken && (
                <div className="absolute -right-2 -top-2 bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-1 rounded-full shadow-lg flex items-center gap-1 z-20 animate-bounce pointer-events-none">
                  <MousePointerClick size={14} /> CLICK TO TAKE
                </div>
              )}

              {!isBeingTaken && (
                 <div className="absolute right-2 bottom-1 text-[10px] text-slate-400 font-mono bg-slate-900/50 px-1 rounded">
                    {row.cards.reduce((sum, c) => sum + (c ? c.bullHeads : 0), 0)} Heads
                 </div>
              )}
            </div>
          );
        })}
      </div>
      
      {canInteract && takingRowIndex === -1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-max max-w-[90%] text-center text-yellow-300 font-bold animate-pulse text-sm sm:text-lg bg-black/60 backdrop-blur px-4 py-2 rounded-full border border-yellow-500/50 shadow-lg pointer-events-none z-30">
          ⚠ Card too low! Tap a row to capture it.
        </div>
      )}

      {isChoosingPhase && !isMyTurnToChooseRow && takingRowIndex === -1 && (
         <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-max max-w-[90%] text-center text-slate-300 font-bold text-sm sm:text-lg bg-black/60 backdrop-blur px-6 py-3 rounded-full border border-slate-600 shadow-lg pointer-events-none z-30 flex items-center gap-3">
           <Loader className="animate-spin text-yellow-500" size={20} />
           Waiting for <span className="text-yellow-400">{choosingPlayerName}</span> to choose a row...
        </div>
      )}

    </div>
  );
};

export default GameBoard;
