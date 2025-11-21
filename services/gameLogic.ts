
import { CardData, GameRow, Player } from '../types';

export const TOTAL_CARDS = 104;

/**
 * Calculates the number of bull heads for a given card number.
 */
export const getBullHeads = (num: number): number => {
  if (num === 55) return 7;
  if (num % 11 === 0) return 5; // 11, 22, 33, 44, 66, 77, 88, 99
  if (num % 10 === 0) return 3; // 10, 20, 30...
  if (num % 5 === 0) return 2;  // 5, 15, 25... (excluding 10s and 55)
  return 1;
};

/**
 * Generates the full deck of 104 cards.
 */
export const generateDeck = (): CardData[] => {
  const deck: CardData[] = [];
  for (let i = 1; i <= TOTAL_CARDS; i++) {
    deck.push({
      id: i,
      bullHeads: getBullHeads(i)
    });
  }
  return deck;
};

/**
 * Shuffles an array of cards.
 */
export const shuffleDeck = (deck: CardData[]): CardData[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

/**
 * Finds the correct row index for a card to be placed.
 * Returns -1 if the card is smaller than all row ends (player must choose).
 */
export const findTargetRowIndex = (card: CardData, rows: GameRow[]): number => {
  let bestRowIndex = -1;
  let minDiff = Infinity;
  const cardId = Number(card.id); // Force Number type to prevent string comparison bugs

  rows.forEach((row, index) => {
    if (!row.cards || row.cards.length === 0) return; // Safety check
    
    const lastCard = row.cards[row.cards.length - 1];
    const lastCardId = Number(lastCard.id); // Force Number type
    
    if (cardId > lastCardId) {
      const diff = cardId - lastCardId;
      if (diff < minDiff) {
        minDiff = diff;
        bestRowIndex = index;
      }
    }
  });

  return bestRowIndex;
};

/**
 * Calculates the total bull heads in a list of cards.
 */
export const sumBullHeads = (cards: CardData[] | undefined): number => {
  if (!cards || !Array.isArray(cards)) return 0;
  return cards.reduce((sum, card) => sum + card.bullHeads, 0);
};

/**
 * Calculates score for a round based on the updated formula:
 * Score = (Total Game Bull Heads) - (My Bull Heads * Total Player Count)
 */
export const calculateRoundScore = (player: Player, allPlayers: Player[]): number => {
  const myHeads = sumBullHeads(player.collectedCards || []);
  const totalHeads = allPlayers.reduce((sum, p) => sum + sumBullHeads(p.collectedCards || []), 0);
  const playerCount = allPlayers.length;

  return totalHeads - (myHeads * playerCount);
};
