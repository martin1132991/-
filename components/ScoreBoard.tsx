import React, { useState } from 'react';
import { Player, PlayerType } from '../types';
import { sumBullHeads, calculateRoundScore } from '../services/gameLogic';
import { X, Trophy, Skull, ArrowUp, Calculator } from 'lucide-react';

interface ScoreBoardProps {
  players: Player[];
  currentRound: number;
  isOpen: boolean;
  onClose: () => void;
}

const ScoreBoard: React.FC<ScoreBoardProps> = ({ players, currentRound, isOpen, onClose }) => {
  const [viewMode, setViewMode] = useState<'total' | number>('total');

  if (!isOpen) return null;

  // Determine if the current round is already finalized in history or is live.
  // App.tsx updates history before incrementing currentRound, so if they match, it's finalized/transitioning.
  const historyLength = players[0].scoreHistory.length;
  const isRoundFinalized = historyLength === currentRound;

  // Calculate data for each player based on the current state
  const tableData = players.map(player => {
    const currentHeads = sumBullHeads(player.collectedCards);
    
    // If round is NOT finalized, we calculate live score.
    // If it IS finalized, the live cards are technically cleared or about to be cleared,
    // but the score is already recorded in history.
    const liveRoundScore = calculateRoundScore(player, players);
    
    const historyTotalScore = player.totalScore; // This includes history rounds
    const historyTotalHeads = player.scoreHistory.reduce((acc, h) => acc + h.heads, 0);

    // If round is in progress (not finalized), Total = History Total + Live Projection.
    // If round is finalized, Total = History Total (which already includes the round).
    const projectedTotalScore = isRoundFinalized 
      ? historyTotalScore 
      : historyTotalScore + liveRoundScore;

    const projectedTotalHeads = isRoundFinalized
      ? historyTotalHeads
      : historyTotalHeads + currentHeads;

    return {
      ...player,
      live: {
        score: liveRoundScore,
        heads: currentHeads
      },
      totals: {
        score: projectedTotalScore,
        heads: projectedTotalHeads
      }
    };
  });

  // Determine what to display based on viewMode
  const getDisplayData = (p: typeof tableData[0]) => {
    if (viewMode === 'total') {
      return {
        score: p.totals.score,
        heads: p.totals.heads,
        label: isRoundFinalized ? 'Total Score' : 'Proj. Total'
      };
    }

    // Viewing a specific round
    const roundIndex = viewMode - 1;
    
    // If viewing the current round which is NOT finalized yet -> Show Live
    if (viewMode === currentRound && !isRoundFinalized) {
       return {
         score: p.live.score,
         heads: p.live.heads,
         label: `Round ${viewMode} (Live)`
       };
    }

    // Otherwise get from history
    const history = p.scoreHistory[roundIndex];
    return {
      score: history?.score ?? 0,
      heads: history?.heads ?? 0,
      label: `Round ${viewMode}`
    };
  };

  // Sort players by Total Projected Score ALWAYS, regardless of viewMode
  const sortedPlayers = [...tableData].sort((a, b) => {
    return b.totals.score - a.totals.score; // Highest score wins
  });

  // Generate tabs for rounds
  const rounds = Array.from({ length: currentRound }, (_, i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-800 w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex flex-col border-b border-slate-700 bg-slate-900/50 rounded-t-2xl">
           <div className="flex items-center justify-between p-6 pb-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-500/20 rounded-full">
                   <Trophy className="text-yellow-400" size={24} />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Scoreboard</h2>
                  <div className="flex items-center gap-3 text-sm text-slate-400">
                    <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                      <ArrowUp size={14} /> Objective: Highest Score Wins
                    </span>
                  </div>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white"
              >
                <X size={24} />
              </button>
           </div>

           {/* Tabs */}
           <div className="flex gap-2 px-6 pb-4 overflow-x-auto no-scrollbar">
              <button
                onClick={() => setViewMode('total')}
                className={`
                  px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap
                  ${viewMode === 'total' 
                    ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-900/50' 
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'}
                `}
              >
                Total Score
              </button>
              {rounds.map(r => (
                <button
                  key={r}
                  onClick={() => setViewMode(r)}
                  className={`
                    px-4 py-2 rounded-lg font-bold text-sm transition-all whitespace-nowrap flex items-center gap-2
                    ${viewMode === r 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'}
                  `}
                >
                  Round {r}
                  {r === currentRound && !isRoundFinalized && <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/>}
                </button>
              ))}
           </div>
        </div>

        {/* Table Container */}
        <div className="overflow-auto p-0 flex-1">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-800 shadow-md z-10">
              <tr className="text-slate-400 text-xs uppercase tracking-wider">
                <th className="py-4 pl-6 w-20">Rank</th>
                <th className="py-4">Player</th>
                <th className="py-4 text-center">
                   {viewMode === 'total' ? 'Total Heads' : 'Round Heads'}
                </th>
                <th className="py-4 text-right pr-6">
                   {viewMode === 'total' ? 'Total Score' : 'Round Score'}
                </th>
              </tr>
            </thead>
            <tbody className="text-slate-200 text-sm sm:text-base divide-y divide-slate-700/50">
              {sortedPlayers.map((player, index) => {
                const data = getDisplayData(player);
                const isHuman = player.type === PlayerType.HUMAN;
                const isWinning = index === 0;
                
                return (
                  <tr 
                    key={player.id} 
                    className={`
                      hover:bg-slate-700/30 transition-colors
                      ${isHuman ? 'bg-emerald-900/10' : ''}
                    `}
                  >
                    <td className="py-4 pl-6 font-mono text-slate-500">
                      {isWinning ? <span className="text-yellow-500 text-lg">👑</span> : <span className="text-lg">#{index + 1}</span>}
                    </td>
                    <td className="py-4 font-medium">
                      <div className="flex items-center gap-2">
                        <span className={isHuman ? 'text-emerald-400 font-bold text-lg' : 'text-slate-300 text-lg'}>
                          {player.name}
                        </span>
                        {isHuman && <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded border border-emerald-800">YOU</span>}
                      </div>
                    </td>
                    <td className="py-4 text-center">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full font-mono font-bold ${data.heads > 0 ? 'text-red-300 bg-red-900/30' : 'text-slate-500'}`}>
                         <Skull size={16} /> {data.heads}
                      </div>
                    </td>
                    <td className="py-4 text-right pr-6">
                       <span className={`font-bold text-2xl font-mono
                          ${isWinning ? 'text-yellow-400' : 'text-white'}
                       `}>
                         {data.score}
                       </span>
                       {viewMode === currentRound && !isRoundFinalized && (
                         <div className="text-[10px] text-emerald-500 flex items-center justify-end gap-1 mt-1">
                           <Calculator size={10}/> Projected
                         </div>
                       )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ScoreBoard;