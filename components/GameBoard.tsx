import React from 'react';
import { CardData, GameRow, GamePhase, Player } from '../types';
import Card from './Card';
import { MousePointerClick, Skull, ArrowDown, Loader } from 'lucide-react';

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
  choosingPlayerName = 'Unknown'
}) => {
  const isChoosingPhase = phase === GamePhase.CHOOSING_ROW;
  
  // Determine if the local user is allowed to interact with the rows
  // Must be in CHOOSING_ROW phase AND explicitly their turn
  const canInteract = isChoosingPhase && isMyTurnToChooseRow;

  // Logic for Staging Area Animation
  const activeTurn = (resolvingIndex >= 0 && turnCards && turnCards[resolvingIndex]) ? turnCards[resolvingIndex] : null;
  const activeCard = activeTurn ? activeTurn.card : null;
  const activePlayerId = activeTurn ? activeTurn.playerId : null;

  // Find target row for the active card to animate towards
  let targetRowIndex = -1;
  if (activeCard && phase === GamePhase.RESOLVING) {
     // Simple logic to find visual target - strictly for animation direction
     // The real logic is in gameLogic.ts, this is just for UI "flying" effect
     let maxVal = -1;
     rows.forEach((row, idx) => {
        const last = row.cards[row.cards.length - 1];
        if (activeCard.id > last.id && last.id > maxVal) {
           maxVal = last.id;
           targetRowIndex = idx;
        }
     });
  }

  return (
    <div className="flex-1 flex flex-col justify-center max-w-5xl mx-auto w-full py-2 sm:py-4 relative">
      
      {/* STAGING AREA (Reveal Phase & Resolving) */}
      {(phase === GamePhase.REVEAL || phase === GamePhase.RESOLVING || isChoosingPhase) && (
        <div className="mb-4 sm:mb-8 min-h-[140px] sm:min-h-[180px] flex justify-center items-center perspective-1000">
          <div className="flex flex-wrap justify-center gap-2 sm:gap-4 w-full px-2">
            {turnCards.map((turn, idx) => {
              const player = players.find(p => p.id === turn.playerId);
              const isResolving = idx === resolvingIndex;
              const isDone = idx < resolvingIndex;
              
              // Animation Styles
              let transformStyle = {};
              let opacityStyle = 1;

              if (phase === GamePhase.RESOLVING && isResolving && targetRowIndex !== -1) {
                // Calculate rough translation to target row
                // This is a visual approximation. 
                // Row 0 is approx 100px down, Row 3 is approx 400px down
                const yOffset = 150 + (targetRowIndex * 100); 
                transformStyle = { 
                  transform: `translateY(${yOffset}px) scale(0.5)`,
                  opacity: 0,
                  transition: 'all 0.8s ease-in-out'
                };
                opacityStyle = 0;
              } else if (isDone) {
                 return null; // Remove from staging once processed
              }

              return (
                 <div 
                  key={idx} 
                  className="flex flex-col items-center transition-all duration-500"
                  style={transformStyle}
                 >
                   <div className={`relative transition-transform duration-300 ${isResolving ? 'scale-110 z-20 ring-4 ring-yellow-400 rounded-lg' : 'scale-90 opacity-80'}`}>
                      <Card 
                        id={turn.card.id} 
                        bullHeads={turn.card.bullHeads} 
                        revealed={true}
                        selected={isResolving}
                      />
                      {isResolving && (
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-bounce text-yellow-400">
                          <ArrowDown size={24} fill="currentColor" />
                        </div>
                      )}
                   </div>
                   <span className={`mt-2 text-xs sm:text-sm font-bold px-2 py-1 rounded-full ${isResolving ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-slate-300'}`}>
                     {player?.name || '???'}
                   </span>
                 </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ROWS GRID */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4">
        {rows.map((row, idx) => {
          const isBeingTaken = takingRowIndex === idx;
          
          // Determine who is taking the row for the label
          let takerName = "SOMEONE";
          if (isBeingTaken && activePlayerId) {
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
                    : 'bg-emerald-900/50'
                }
              `}
              onClick={() => {
                if (canInteract && onSelectRow) {
                  onSelectRow(idx);
                }
              }}
            >
              {/* Row Number Badge */}
              <div className={`
                absolute -left-2 sm:-left-4 w-6 h-6 sm:w-8 sm:h-8 flex items-center justify-center rounded-full font-bold text-xs sm:text-sm shadow-lg z-20
                ${isBeingTaken ? 'bg-red-500 text-white animate-ping' : 'bg-slate-700 text-slate-200 border-2 border-slate-600'}
              `}>
                {idx + 1}
              </div>

              {/* Cards in Row */}
              <div className="flex flex-wrap gap-1 sm:gap-2 pl-3 sm:pl-4">
                {row.cards.map((card, cIdx) => (
                  <div key={card.id} className={`${isBeingTaken ? 'animate-pulse scale-95 brightness-75 transition-all' : ''}`}>
                    <Card 
                      id={card.id} 
                      bullHeads={card.bullHeads} 
                      small={true}
                      revealed={true}
                    />
                  </div>
                ))}
              </div>

              {/* Taking Row Animation Overlay */}
              {isBeingTaken && (
                 <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/20 backdrop-blur-[2px] rounded-lg">
                    <div className="bg-red-600 text-white font-black text-lg sm:text-2xl px-6 py-2 rounded-full shadow-2xl animate-bounce flex items-center gap-2 border-4 border-red-400">
                      <Skull size={28} /> 
                      {takerName} TAKING ROW {idx + 1}
                    </div>
                 </div>
              )}

              {/* Selection Badge - Only if allowed to interact */}
              {canInteract && !isBeingTaken && (
                <div className="absolute -right-2 -top-2 bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-1 rounded-full shadow-lg flex items-center gap-1 z-20 animate-bounce pointer-events-none">
                  <MousePointerClick size={14} /> CLICK TO TAKE
                </div>
              )}

              {/* Row Stats (Hover or Always visible on desktop) */}
              {!isBeingTaken && (
                 <div className="absolute right-2 bottom-1 text-[10px] text-slate-400 font-mono">
                    {row.cards.reduce((sum, c) => sum + c.bullHeads, 0)} Heads
                 </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Alert for Active Player */}
      {canInteract && takingRowIndex === -1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-max max-w-[90%] text-center text-yellow-300 font-bold animate-pulse text-sm sm:text-lg bg-black/60 backdrop-blur px-4 py-2 rounded-full border border-yellow-500/50 shadow-lg pointer-events-none z-30">
          ⚠ Card too low! Tap a row to capture it.
        </div>
      )}

      {/* Waiting Message for Other Players */}
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