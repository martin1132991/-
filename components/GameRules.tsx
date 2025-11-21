
import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface GameRulesProps {
  isOpen: boolean;
  onClose: () => void;
}

const GameRules: React.FC<GameRulesProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-800 w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-700 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700 bg-slate-900/50 rounded-t-2xl">
           <h2 className="text-2xl font-bold text-white flex items-center gap-2">
             <AlertTriangle className="text-yellow-500" /> 遊戲玩法 (Game Rules)
           </h2>
           <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-white">
             <X size={24} />
           </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6 text-slate-300 space-y-6 leading-relaxed">
           
           <section>
             <h3 className="text-xl font-bold text-emerald-400 mb-2 flex items-center gap-2">🎯 遊戲目標 (Objective)</h3>
             <p>
               盡量避免吃到任何紙牌！每張紙牌上都有牛頭（Bull Heads），這代表扣分。
               <br/>
               在本遊戲的特殊計分制度下，<strong>分數越高越好</strong>。吃到越多牛頭，分數扣得越重。
             </p>
           </section>

           <section>
             <h3 className="text-xl font-bold text-blue-400 mb-2 flex items-center gap-2">🃏 遊戲流程 (Gameplay)</h3>
             <ol className="list-decimal pl-5 space-y-2">
               <li>每回合所有玩家同時選擇一張手牌。</li>
               <li>所有牌亮出後，由<strong>數字最小</strong>的牌開始結算。</li>
               <li>
                 <strong>放置規則：</strong> 你的牌必須接在比它小、且數字最接近的那張牌後面。
               </li>
             </ol>
           </section>

           <section>
             <h3 className="text-xl font-bold text-red-400 mb-2 flex items-center gap-2">⚠️ 懲罰機制 (Penalties)</h3>
             <div className="space-y-3 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                <div className="flex gap-3">
                   <div className="min-w-[24px] pt-1 font-bold text-red-500">1.</div>
                   <div>
                     <strong className="text-white">爆牌 (The 6th Card):</strong> 
                     <p className="text-sm mt-1">如果一行已經有 5 張牌，你的牌成為第 6 張時，你必須<strong>吃掉這一整行</strong>（拿走前 5 張作為扣分），然後你的牌成為該行的新頭牌。</p>
                   </div>
                </div>
                <div className="flex gap-3">
                   <div className="min-w-[24px] pt-1 font-bold text-red-500">2.</div>
                   <div>
                     <strong className="text-white">過小 (Too Low):</strong> 
                     <p className="text-sm mt-1">如果你的牌比場上所有行的結尾都小，你必須<strong>選擇一行吃掉</strong>。你的牌取代該行。</p>
                   </div>
                </div>
             </div>
           </section>

           <section>
             <h3 className="text-xl font-bold text-yellow-400 mb-2 flex items-center gap-2">📊 計分方法 (Scoring)</h3>
             <p>遊戲結束時，計算每位玩家吃到的牛頭總數。</p>
             <div className="mt-2 p-3 bg-slate-700/50 rounded border border-slate-600 font-mono text-sm">
               分數 = (全場總牛頭數) - (你吃到的牛頭數 × 玩家人數)
             </div>
             <p className="mt-2 text-sm italic text-slate-400">
               簡單來說：別人吃牛頭你加分（相對），你自己吃牛頭扣大分。
             </p>
           </section>

        </div>
        
        <div className="p-4 border-t border-slate-700 bg-slate-900/50 rounded-b-2xl flex justify-end">
           <button onClick={onClose} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg">
             明白 (Got it)
           </button>
        </div>
      </div>
    </div>
  );
};

export default GameRules;
