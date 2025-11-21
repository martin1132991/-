
import React from 'react';
import { GameRow, GamePhase, CardData, Player } from '../types';
import { sumBullHeads, findTargetRowIndex } from '../services/gameLogic';
import Card from './Card';
import { MousePointerClick, Skull } from 'lucide-react';

interface GameBoardProps {
  rows: GameRow[];
  onSelectRow?: (rowIndex: number) => void;
  phase: GamePhase;
  takingRowIndex?: number;
  turnCards?: {playerId: string, card: CardData}[];
  resolvingIndex?: number;
  players?: Player[];
}

const GameBoard: React.FC<GameBoardProps> = ({ 
  rows, 
  onSelectRow, 
  phase, 
  takingRowIndex = -1,
  turnCards = [],
  resolvingIndex = -1,
  players = []
}) => {
  const isChoosing = phase === GamePhase.CHOOSING_ROW;
  const showStaging = phase === GamePhase.REVEAL || phase === GamePhase.RESOLVING || phase === GamePhase.CHOOSING_ROW;

  return (
    <div className="w-full max-w-5xl mx-auto p-2 sm:p-4 bg-emerald-800/90 rounded-xl shadow-2xl border-8 border-emerald-900 relative flex flex-col gap-4 sm:gap-8">
      
      {/* STAGING AREA (Revealed Cards) */}
      {showStaging && turnCards.length > 0 && (
        <div className="w-full min-h-[140px] bg-emerald-900/60 rounded-lg border-2 border-emerald-700/50 p-4 flex items-center justify-center gap-2 sm:gap-6 overflow-x-auto no-scrollbar relative z-20">
           {turnCards.map((turn, idx) => {
             const player = players.find(p => p.id === turn.playerId);
             const isResolved = idx < resolvingIndex;
             const isActive = idx === resolvingIndex;
             
             // Calculate Target Row for Animation
             let translateClass = '';
             if (isActive && phase === GamePhase.RESOLVING) {
                const targetRowIdx = findTargetRowIndex(turn.card, rows);
                if (targetRowIdx !== -1) {
                   // Estimate translation for animation effect
                   if (targetRowIdx === 0) translateClass = 'translate-y-[180px] opacity-0 scale-50';
                   if (targetRowIdx === 1) translateClass = 'translate-y-[290px] opacity-0 scale-50';
                   if (targetRowIdx === 2) translateClass = 'translate-y-[400px] opacity-0 scale-50';
                   if (targetRowIdx === 3) translateClass = 'translate-y-[510px] opacity-0 scale-50';
                } else {
                   // Low card (taking row) - just pulse in place/scale up
                   translateClass = 'scale-125 ring-4 ring-red-500 z-30';
                }
             }

             return (
               <div 
                 key={idx} 
                 className={`
                   flex flex-col items-center gap-2 transition-all duration-1000 ease-in-out
                   ${isResolved ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100 w-20 sm:w-24'}
                   ${translateClass}
                 `}
               >
                 <div className="text-xs sm:text-sm font-bold text-emerald-200 whitespace-nowrap shadow-black drop-shadow-md">
                   {player?.name || 'Unknown'}
                 </div>
                 <Card id={turn.card.id} bullHeads={turn.card.bullHeads} />
               </div>
             );
           })}
        </div>
      )}

      {/* ROWS GRID */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4">
        {rows.map((row, idx) => {
          const isBeingTaken = takingRowIndex === idx;
          
          // Determine who is taking the row
          let takerName = "SOMEONE";
          if (isBeingTaken && resolvingIndex >= 0 && turnCards[resolvingIndex]) {
            const playerId = turnCards[resolvingIndex].playerId;
            const player = players.find(p => p.id === playerId);
            if (player) takerName = player.name.toUpperCase();
          }
          
          return (
            <div 
              key={idx} 
              className={`
                relative flex items-center p-2 sm:p-3 rounded-lg transition-all duration-500 min-h-[100px] sm:min-h-[120px]
                ${isBeingTaken 
                  ? 'bg-red-900/80 border-4 border-red-500 scale-[1.02] shadow-[0_0_30px_rgba(239,68,68,0.6)] z-10' 
                  : isChoosing 
                    ? 'bg-yellow-900/40 hover:bg-yellow-600/40 cursor-pointer ring-4 ring-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)] scale-[1.01]' 
                    : 'bg-emerald-900/50'
                }
              `}
              onClick={() => {
                if (isChoosing && onSelectRow) {
                  onSelectRow(idx);
                }
              }}
            >
              {/* TAKING ANIMATION OVERLAY */}
              {isBeingTaken && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg z-20 animate-pulse pointer-events-none">
                   <div className="bg-red-600 text-white px-6 py-3 rounded-xl font-black text-lg sm:text-xl shadow-2xl flex items-center gap-2 transform rotate-[-2deg] border-2 border-white/20">
                     <Skull size={28} className="animate-bounce" />
                     <span className="whitespace-nowrap">{takerName} TAKES ROW!</span>
                   </div>
                </div>
              )}

              {/* Selection Badge */}
              {isChoosing && !isBeingTaken && (
                <div className="absolute -right-2 -top-2 bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-1 rounded-full shadow-lg flex items-center gap-1 z-20 animate-bounce pointer-events-none">
                  <MousePointerClick size={14} /> CLICK TO TAKE
                </div>
              )}

              {/* Row Info Tag */}
              <div className="mr-2 sm:mr-4 flex flex-col items-center justify-center w-12 sm:w-16 h-full text-emerald-100 border-r border-emerald-800/50 pr-2">
                <span className="font-bold text-lg">#{idx + 1}</span>
                <span className="text-[10px] sm:text-xs opacity-75 text-center">{sumBullHeads(row.cards)} Heads</span>
              </div>

              {/* Cards in Row */}
              <div className={`flex items-center gap-1 sm:gap-2 flex-1 overflow-x-auto no-scrollbar transition-opacity duration-500 ${isBeingTaken ? 'opacity-50 blur-sm' : ''}`}>
                {row.cards.map((card) => (
                  <div key={card.id} className="flex-shrink-0 transition-all duration-300 animate-in slide-in-from-right-4 fade-in">
                    <Card id={card.id} bullHeads={card.bullHeads} small />
                  </div>
                ))}
                
                {/* Placeholder slots */}
                {Array.from({ length: Math.max(0, 5 - row.cards.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="w-12 h-16 sm:w-14 sm:h-20 border-2 border-emerald-700/30 rounded-lg border-dashed flex-shrink-0" />
                ))}
                
                {/* The 6th slot - DANGER ZONE */}
                <div className="w-12 h-16 sm:w-14 sm:h-20 border-2 border-red-500/30 bg-red-900/10 rounded-lg flex items-center justify-center flex-shrink-0 ml-1">
                  <span className="text-red-500/50 text-[10px] font-bold">MAX</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      {isChoosing && takingRowIndex === -1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-max max-w-[90%] text-center text-yellow-300 font-bold animate-pulse text-sm sm:text-lg bg-black/60 backdrop-blur px-4 py-2 rounded-full border border-yellow-500/50 shadow-lg pointer-events-none z-30">
          ⚠ Card too low! Tap a row to capture it.
        </div>
      )}
    </div>
  );
};

export default GameBoard;
