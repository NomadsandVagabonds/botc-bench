/**
 * Always-visible chat panel — parchment-styled.
 * Filters out group/breakout messages.
 */

import { useRef, useEffect } from 'react';
import { useGameStore } from '../../../stores/gameStore.ts';

export function ChatPanel() {
  const gameState = useGameStore(s => s.gameState);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = (gameState?.messages ?? []).filter(msg => {
    if (msg.type === 'breakout' || msg.groupId) return false;
    return true;
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const players = gameState?.players ?? [];

  return (
    <div style={{
      width: 320, height: '100%',
      backgroundImage: 'url(/parchment.jpg)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      fontFamily: 'Georgia, serif',
      borderRight: '2px solid #3d2812',
      position: 'relative', zIndex: 1,
    }}>
      <div style={{
        padding: '10px 16px',
        fontSize: 14, color: '#c9a84c', fontWeight: 'bold',
        background: 'linear-gradient(180deg, #4a4a4a 0%, #333 40%, #2a2a2a 100%)',
        boxShadow: 'inset 0 1px 0 #666, inset 0 -1px 0 #111, 0 2px 4px rgba(0,0,0,0.3)',
        textShadow: '0 1px 2px rgba(0,0,0,0.5)',
        borderBottom: '2px solid #1a1a1a',
      }}>
        Village Discourse
        <span style={{ fontWeight: 'normal', color: '#999', fontSize: 11, marginLeft: 8 }}>
          {messages.length}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '6px 12px' }}>
        {messages.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: '#5c3d1a', fontSize: 13, fontStyle: 'italic' }}>
            The village is silent...
          </div>
        )}

        {messages.map((msg, i) => {
          const sender = players.find(p => p.seat === msg.senderSeat);
          const senderName = sender?.characterName || (msg.senderSeat != null ? `Seat ${msg.senderSeat}` : '');
          const isSystem = msg.type === 'system';
          const isNarration = msg.type === 'narration';
          const isAccusation = msg.type === 'accusation';
          const isDefense = msg.type === 'defense';

          return (
            <div key={msg.id ?? i} style={{
              padding: '3px 0', fontSize: 12,
              color: isSystem ? '#6b5530' : '#3d2812',
              fontStyle: isSystem || isNarration ? 'italic' : 'normal',
              borderLeft: isAccusation ? '3px solid #8b0000'
                : isDefense ? '3px solid #2d5a2d'
                : isSystem ? 'none'
                : '3px solid #c9a84c44',
              paddingLeft: isSystem ? 0 : 8,
              marginBottom: 2,
              lineHeight: 1.4,
            }}>
              {!isSystem && !isNarration && senderName && (
                <span style={{
                  color: isAccusation ? '#8b0000' : isDefense ? '#2d5a2d' : '#5c3d1a',
                  fontWeight: 'bold', marginRight: 4, fontSize: 11,
                }}>
                  {isAccusation ? 'ACCUSE ' : isDefense ? 'DEFEND ' : ''}
                  {senderName}:
                </span>
              )}
              {isNarration && (
                <span style={{ color: '#5c3d1a', marginRight: 4 }}>[Narrator]</span>
              )}
              <span>{msg.content}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
