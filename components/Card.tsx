import React from 'react';

interface CardProps {
  id: number;
  bullHeads: number;
  onClick?: () => void;
  selected?: boolean;
  revealed?: boolean; // If false, shows back of card
  small?: boolean; // For board rows
  disabled?: boolean;
}

// Custom Bull Head Icon
const BullHeadIcon: React.FC<{ size: number, className?: string }> = ({ size, className }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M20.8 4.2c-1.5-1.5-3.5-2.2-5.8-2.2-1.5 0-2.8 1.2-2.8 2.8v.2c0 1 .8 1.8 1.8 1.8.4 0 .8-.1 1.1-.4.8-.6 1.8-.8 2.8-.8.8 0 1.5.7 1.5 1.5v2.5c0 2-2.5 4-7.5 4s-7.5-2-7.5-4V6.8c0-.8.7-1.5 1.5-1.5 1 0 2 .3 2.8.8.3.2.7.4 1.1.4 1 0 1.8-.8 1.8-1.8V4.5C11.8 2.9 10.4 1.7 8.9 1.7 6.6 1.7 4.6 2.4 3.1 3.9 1.3 5.7 1 8.5 2.2 11c1.6 3.3 5.6 5 9.7 5s8.1-1.7 9.7-5c1.3-2.5 1-5.3-.8-6.8zM7 16l1 1h8l1-1" />
  </svg>
);

const Card: React.FC<CardProps> = ({ 
  id, 
  bullHeads, 
  onClick, 
  selected, 
  revealed = true, 
  small = false, 
  disabled = false
}) => {
  
  // Determine background color based on bull heads intensity
  const getBgColor = () => {
    if (!revealed) return 'bg-indigo-900';
    if (bullHeads >= 7) return 'bg-red-100';
    if (bullHeads >= 5) return 'bg-orange-100';
    if (bullHeads >= 2) return 'bg-yellow-50';
    return 'bg-white';
  };

  const getBorderColor = () => {
    if (!revealed) return 'border-indigo-800';
    if (selected) return 'border-emerald-500 ring-4 ring-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.6)] transform -translate-y-2';
    if (bullHeads >= 5) return 'border-red-400';
    return 'border-slate-300';
  };

  const getHeadColor = () => {
    if (bullHeads >= 7) return 'text-red-600';
    if (bullHeads >= 5) return 'text-orange-500';
    if (bullHeads >= 2) return 'text-blue-500';
    return 'text-slate-400';
  };

  const baseClasses = `
    relative flex flex-col items-center justify-between 
    rounded-lg border-2 shadow-md transition-all duration-200 select-none
    ${getBgColor()} ${getBorderColor()} 
    ${disabled ? 'opacity-50 cursor-not-allowed' : onClick ? 'cursor-pointer hover:-translate-y-1' : ''}
  `;

  const sizeClasses = small 
    ? 'w-12 h-16 sm:w-14 sm:h-20 p-1 text-xs' 
    : 'w-20 h-28 sm:w-24 sm:h-36 p-2 text-base sm:text-xl';

  if (!revealed) {
    return (
      <div className={`${baseClasses} ${sizeClasses} justify-center`}>
        <div className="w-full h-full rounded bg-indigo-800 border border-indigo-700 opacity-80 flex items-center justify-center">
          <span className="text-indigo-400 font-bold text-2xl">?</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${baseClasses} ${sizeClasses}`} onClick={!disabled ? onClick : undefined}>
      {/* Top Left Number */}
      <div className="w-full flex justify-start font-bold text-slate-800 leading-none">
        {id}
      </div>

      {/* Center Visual (Heads) */}
      <div className={`flex flex-wrap justify-center content-center gap-0.5 ${getHeadColor()}`}>
        {/* Render bull heads visually based on count */}
        {Array.from({ length: Math.min(bullHeads, 7) }).map((_, i) => (
           <BullHeadIcon key={i} size={small ? 10 : 18} className="opacity-90" />
        ))}
      </div>

      {/* Bottom Right Number */}
      <div className="w-full flex justify-end font-bold text-slate-800 leading-none transform rotate-180">
        {id}
      </div>
    </div>
  );
};

export default Card;