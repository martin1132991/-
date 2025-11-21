import { GoogleGenAI, Type } from "@google/genai";
import { CardData, GameRow, Player } from '../types';
import { findTargetRowIndex, sumBullHeads } from './gameLogic';

// Initialize Gemini client
// Ensure process.env.API_KEY is available.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const getBotDecision = async (
  bot: Player, 
  rows: GameRow[], 
  playedCards: CardData[] // Cards already played/known this round (optional context)
): Promise<CardData> => {
  
  // --- Advanced Heuristic Logic (Fallback & Fast) ---
  // This logic is used if API is missing or fails, but it's also a strong baseline.
  const advancedHeuristicLogic = (): CardData => {
    const scoredCards = bot.hand.map(card => {
      const rowIndex = findTargetRowIndex(card, rows);
      let riskScore = 0;
      let debugReason = "";

      // Scenario A: Card is lower than all row ends (Must take a row)
      if (rowIndex === -1) {
        // Calculate the best case damage (taking the row with fewest heads)
        const minRowHeads = Math.min(...rows.map(r => sumBullHeads(r.cards)));
        
        // Logic: If we MUST take a row, we prefer to do it with a very low card (1-15)
        // to save our safe high cards for later. 
        // High Score = Bad.
        riskScore = 100 + minRowHeads; 
        debugReason = "Must take row";
        
        // Tie-breaker: If multiple cards must take a row, prefer the smallest one
        // to keep larger cards that might fit later.
        riskScore += (card.id / 1000); 
      } 
      // Scenario B: Card fits into a row
      else {
        const targetRow = rows[rowIndex];
        const gap = card.id - targetRow.cards[targetRow.cards.length - 1].id;
        const cardsInRow = targetRow.cards.length;

        // 1. Gap Risk: The larger the gap, the more likely an opponent plays in between.
        // A gap of 1 is perfect (Risk 0). A gap of 20 is dangerous.
        riskScore += gap; 

        // 2. Row Fullness Risk
        if (cardsInRow === 5) {
          // This makes it the 6th card! Guaranteed capture!
          const rowHeads = sumBullHeads(targetRow.cards);
          riskScore = 500 + rowHeads; // Extremely bad, unless taking row is better than option A
          debugReason = "Triggers 6th card take";
        } else if (cardsInRow === 4) {
          // This makes it the 5th card. Very risky for the NEXT round/player, 
          // but safe for me NOW... unless someone undercuts me this turn?
          // If gap is small (1-2), it's safe. If gap is big, someone might take the spot.
          // We add a slight penalty to avoid setting up others unless necessary.
          riskScore += 5; 
          debugReason = "Sets up 5th card";
        } else {
          // Rows with 1, 2, 3 cards are generally safe.
          debugReason = `Gap ${gap}`;
        }
      }

      return { card, score: riskScore, reason: debugReason };
    });

    // Sort by lowest risk score
    scoredCards.sort((a, b) => a.score - b.score);

    // console.log(`Bot ${bot.name} thinking:`, scoredCards.slice(0, 3));
    return scoredCards[0].card;
  };

  if (!process.env.API_KEY) {
    return advancedHeuristicLogic();
  }

  try {
    const rowDescriptions = rows.map((row, idx) => {
      const last = row.cards[row.cards.length - 1];
      return `Row ${idx + 1}: Ends with ${last.id} (Count: ${row.cards.length}/5, Heads in row: ${sumBullHeads(row.cards)})`;
    }).join('\n');

    const handDescription = bot.hand.map(c => `${c.id}`).join(', ');

    // Improved Prompt with Strategy Instructions
    const prompt = `
      You are an expert player of "6 Nimmt!" (Cow King). 
      Current Board:
      ${rowDescriptions}

      Your Hand: ${handDescription}

      Strategic Priorities:
      1. GAP ANALYSIS: Find the card with the smallest difference to a row's end number. A gap of 1 is unbeatable. Large gaps allow opponents to play underneath you.
      2. AVOID THE 6TH CARD: A row with 5 cards is a trap. Do not play the 6th card unless you have no choice.
      3. DANGER ZONE: A row with 4 cards is risky. Only play there if your gap is tiny (1-3).
      4. DAMAGE CONTROL: If you MUST take a row (card too low or 6th card), play your LOWEST valued card to save safer cards for later, or play a card that takes a row with very few bull heads.

      Based on these probabilities, select the single best card ID to play.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            cardId: { type: Type.INTEGER }
          },
          required: ["cardId"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    if (result.cardId) {
      const card = bot.hand.find(c => c.id === result.cardId);
      if (card) return card;
    }
    
    return advancedHeuristicLogic();

  } catch (error) {
    // console.error("AI Bot Error, using heuristic:", error);
    return advancedHeuristicLogic();
  }
};

export const getBotRowChoice = async (
  bot: Player,
  rows: GameRow[]
): Promise<number> => {
  // Fallback: Choose row with fewest heads
  const simpleRowChoice = () => {
    let minHeads = Infinity;
    let bestIndex = 0;
    rows.forEach((row, idx) => {
      const heads = sumBullHeads(row.cards);
      if (heads < minHeads) {
        minHeads = heads;
        bestIndex = idx;
      }
    });
    return bestIndex;
  };

   if (!process.env.API_KEY) {
    return simpleRowChoice();
  }

  try {
    const rowDescriptions = rows.map((row, idx) => {
      return `Row ${idx + 1}: Total Heads: ${sumBullHeads(row.cards)}`;
    }).join('\n');

    const prompt = `
      You must take a row in 6 Nimmt!.
      Current Rows:
      ${rowDescriptions}
      
      Choose the row index (0-3) that minimizes the bull heads you collect.
      Return 0 for Row 1, 1 for Row 2, etc.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rowIndex: { type: Type.INTEGER }
          },
          required: ["rowIndex"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    if (typeof result.rowIndex === 'number' && result.rowIndex >= 0 && result.rowIndex <= 3) {
      return result.rowIndex;
    }
    return simpleRowChoice();

  } catch (e) {
    return simpleRowChoice();
  }
}