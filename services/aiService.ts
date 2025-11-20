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
  
  // Fallback simple logic if API key is missing or error occurs
  const simpleLogic = (): CardData => {
    // Try to find a card that fits in a row without being the 6th
    const safeCards = bot.hand.filter(card => {
      const rowIndex = findTargetRowIndex(card, rows);
      if (rowIndex === -1) return false; // Too small, might force take
      if (rows[rowIndex].cards.length === 5) return false; // Will be 6th
      return true;
    });

    if (safeCards.length > 0) {
      // Pick highest safe card to save low ones? Or lowest safe? 
      // Let's pick random safe.
      return safeCards[Math.floor(Math.random() * safeCards.length)];
    }
    // If no safe move, pick lowest value to minimize potential damage if we assume others play high?
    // Or pick smallest to take a row now if we have to.
    return bot.hand.sort((a, b) => a.id - b.id)[0];
  };

  if (!process.env.API_KEY) {
    console.warn("No API Key found, using fallback bot logic.");
    return simpleLogic();
  }

  try {
    const rowDescriptions = rows.map((row, idx) => {
      const last = row.cards[row.cards.length - 1];
      return `Row ${idx + 1}: Ends with ${last.id} (Current length: ${row.cards.length}, Total Heads: ${sumBullHeads(row.cards)})`;
    }).join('\n');

    const handDescription = bot.hand.map(c => `${c.id} (${c.bullHeads} heads)`).join(', ');

    const prompt = `
      You are playing the card game "6 Nimmt!" (Cow King).
      Your goal is to avoid collecting bull heads (standard strategy) OR perform damage control.
      
      Current Board State:
      ${rowDescriptions}

      Your Hand:
      ${handDescription}

      Rules refresher:
      1. Card goes to row with closest lower number.
      2. If card is lower than all row ends, you must take a row.
      3. If row has 5 cards, adding a 6th makes you take the 5 cards.

      Select the best card ID from your hand to play.
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
    
    return simpleLogic();

  } catch (error) {
    console.error("AI Bot Error:", error);
    return simpleLogic();
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
      return `Row ${idx}: Total Heads: ${sumBullHeads(row.cards)}`;
    }).join('\n');

    const prompt = `
      You must take a row in 6 Nimmt!.
      Current Rows:
      ${rowDescriptions}
      
      Choose the row index (0-3) that minimizes the bull heads you collect.
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