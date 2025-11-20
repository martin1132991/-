import React from 'react';
import { GameRow, GamePhase } from '../types';
import { sumBullHeads } from '../services/gameLogic';
import Card from './Card';
import { MousePointerClick } from 'lucide-react';

interface GameBoardProps {
  rows: GameRow[];
  onSelectRow?: (rowIndex: number) => void;
  phase: GamePhase;
}

const GameBoard: React.FC<GameBoardProps> = ({ rows, onSelectRow, phase }) => {
  const isChoosing = phase === GamePhase.CHOOSING_ROW;

  return (
    <div className="w-full max-w-5xl mx-auto p-4 bg-emerald-800/90 rounded-xl shadow-2xl border-8 border-emerald-900 relative">
      <div className="grid grid-cols-1 gap-4">
        {rows.map((row, idx) => (
          <div 
            key={idx} 
            className={`
              relative flex items-center p-3 rounded-lg transition-all duration-200
              ${isChoosing 
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
            {/* Selection Badge */}
            {isChoosing && (
              <div className="absolute -right-2 -top-2 bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-1 rounded-full shadow-lg flex items-center gap-1 z-20 animate-bounce">
                <MousePointerClick size={14} /> TAKE
              </div>
            )}

            {/* Row Info Tag */}
            <div className="mr-4 flex flex-col items-center justify-center w-16 h-full text-emerald-100">
              <span className="font-bold text-lg">#{idx + 1}</span>
              <span className="text-xs opacity-75">{sumBullHeads(row.cards)} Heads</span>
            </div>

            {/* Cards in Row */}
            <div className="flex items-center gap-2 flex-1 overflow-x-auto pb-2 no-scrollbar min-h-[80px]">
              {row.cards.map((card) => (
                <div key={card.id} className="flex-shrink-0">
                  <Card id={card.id} bullHeads={card.bullHeads} small />
                </div>
              ))}
              {/* Placeholder slots for up to 5 cards to show capacity */}
              {Array.from({ length: 5 - row.cards.length }).map((_, i) => (
                <div key={`empty-${i}`} className="w-12 h-16 sm:w-14 sm:h-20 border-2 border-emerald-700/30 rounded-lg border-dashed flex-shrink-0" />
              ))}
              {/* The 6th slot - DANGER ZONE */}
              <div className="w-12 h-16 sm:w-14 sm:h-20 border-2 border-red-500/30 bg-red-900/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-red-500 text-xs font-bold">MAX</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {isChoosing && (
        <div className="text-center text-yellow-300 font-bold mt-4 animate-pulse text-lg bg-black/30 p-2 rounded-lg">
          ⚠ Card too low! Tap a row to capture it.
        </div>
      )}
    </div>
  );
};

export default GameBoard;