import { useState, type ReactNode } from 'react';
import { Logo } from './ui';

// A comic-strip guide to the game: nine scenes, one per step. All art is inline SVG in the pub palette.

const C = {
  stout: '#1B1410',
  stout2: '#2a1d15',
  night: '#0d0907',
  mah: '#4A2C1D',
  mah2: '#5A3624',
  brass: '#C9A227',
  emerald: '#1F6F43',
  emerald2: '#2a8f58',
  cream: '#F3E9D2',
  whiskey: '#8E2A1E',
  whiskey2: '#B53A2B',
  blue: '#4B82C4',
};
const DISPLAY = 'Rye, Georgia, serif';
const BODY = 'Lora, Georgia, serif';

const Scene = ({ label, bg = C.stout2, children }: { label: string; bg?: string; children: ReactNode }) => (
  <svg viewBox="0 0 240 150" role="img" aria-label={label}>
    <rect width="240" height="150" fill={bg} />
    {children}
  </svg>
);

const T = (p: { x: number; y: number; size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; display?: boolean; weight?: number; children: ReactNode }) => (
  <text x={p.x} y={p.y} fontSize={p.size ?? 10} fill={p.fill ?? C.cream} textAnchor={p.anchor ?? 'middle'} fontFamily={p.display ? DISPLAY : BODY} fontWeight={p.weight}>
    {p.children}
  </text>
);

function Phone({ x, y, w = 74, h = 124, children }: { x: number; y: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill={C.stout} stroke={C.brass} strokeWidth="3" />
      <rect x={x + w / 2 - 8} y={y + 4} width="16" height="3" rx="1.5" fill={C.brass} opacity="0.6" />
      {children}
    </g>
  );
}

function Person({ x, y, color = C.mah2, skin = C.cream, s = 1 }: { x: number; y: number; color?: string; skin?: string; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x="-14" y="16" width="28" height="30" rx="12" fill={color} stroke={C.stout} strokeWidth="1.5" />
      <circle cx="0" cy="6" r="12" fill={skin} stroke={C.stout} strokeWidth="1.5" />
      <circle cx="-4" cy="5" r="1.6" fill={C.stout} />
      <circle cx="4" cy="5" r="1.6" fill={C.stout} />
    </g>
  );
}

const QR = ['1110101', '1010011', '1110110', '0001001', '1101110', '1011001', '1110101'];

const art = {
  join: (
    <Scene label="A phone showing a room code next to a QR code">
      <Phone x={22} y={13}>
        <T x={59} y={34} size={7} fill={C.brass}>ROOM CODE</T>
        {['A', 'B', 'C', 'D'].map((l, i) => (
          <g key={l}>
            <rect x={31 + i * 15} y={42} width="12" height="18" rx="3" fill={C.mah} stroke={C.brass} strokeWidth="1" />
            <T x={37 + i * 15} y={55} size={11} display>{l}</T>
          </g>
        ))}
        <rect x={31} y={70} width="56" height="14" rx="4" fill={C.mah} stroke={C.brass} strokeWidth="1" />
        <T x={59} y={80} size={7}>Your name</T>
        <rect x={31} y={94} width="56" height="18" rx="5" fill={C.brass} />
        <T x={59} y={106} size={7} fill={C.stout} weight={700}>Pull up a stool</T>
      </Phone>
      <T x={118} y={76} size={11} fill={C.brass} display>or</T>
      <rect x={136} y={34} width="84" height="84" rx="6" fill={C.cream} />
      {QR.map((row, r) => [...row].map((c, i) => (c === '1' ? <rect key={`${r}-${i}`} x={144 + i * 10} y={42 + r * 10} width="8" height="8" fill={C.stout} /> : null)))}
      <T x={178} y={134} size={8}>scan with your camera</T>
    </Scene>
  ),

  cards: (
    <Scene label="A hand holding a role card on a phone, with the four roles beside it">
      <Phone x={20} y={13}>
        <rect x={30} y={30} width="54" height="72" rx="6" fill={C.whiskey} stroke={C.brass} strokeWidth="2" />
        <T x={57} y={62} size={9} display>MAFIA</T>
        <T x={57} y={78} size={6} fill={C.cream}>hold to peek</T>
        <circle cx={57} cy={96} r="13" fill={C.cream} opacity="0.55" />
      </Phone>
      {[
        ['Villager', C.emerald2, 118, 24],
        ['Mafia', C.whiskey2, 176, 24],
        ['Detective', C.blue, 118, 78],
        ['Doctor', C.brass, 176, 78],
      ].map(([name, col, x, y]) => (
        <g key={name as string}>
          <rect x={x as number} y={y as number} width="52" height="48" rx="6" fill={C.stout} stroke={col as string} strokeWidth="2" />
          <circle cx={(x as number) + 26} cy={(y as number) + 20} r="9" fill={col as string} />
          <T x={(x as number) + 26} y={(y as number) + 40} size={8}>{name as string}</T>
        </g>
      ))}
    </Scene>
  ),

  cardsSimple: (
    <Scene label="A phone with a role card, beside the only two roles in Simple Mode">
      <Phone x={20} y={13}>
        <rect x={30} y={30} width="54" height="72" rx="6" fill={C.emerald} stroke={C.brass} strokeWidth="2" />
        <T x={57} y={62} size={8.5} display>VILLAGER</T>
        <T x={57} y={78} size={6} fill={C.cream}>hold to peek</T>
        <circle cx={57} cy={96} r="13" fill={C.cream} opacity="0.55" />
      </Phone>
      {[
        ['Villager', 'most of you', C.emerald2, 118],
        ['Mafia', 'a few Traitors', C.whiskey2, 176],
      ].map(([name, what, col, x]) => (
        <g key={name as string}>
          <rect x={x as number} y={30} width="54" height="62" rx="6" fill={C.stout} stroke={col as string} strokeWidth="2" />
          <circle cx={(x as number) + 27} cy={52} r="11" fill={col as string} />
          <T x={(x as number) + 27} y={77} size={9} weight={600}>{name as string}</T>
          <T x={(x as number) + 27} y={88} size={6.5} fill={C.brass}>{what as string}</T>
        </g>
      ))}
      <T x={172} y={116} size={8.5} fill={C.brass}>No Detective. No Doctor.</T>
    </Scene>
  ),

  nightSimple: (
    <Scene label="At night only the Mafia act while everyone else carries on partying" bg={C.night}>
      {[[24, 18], [64, 34], [104, 12], [150, 24], [30, 54]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 1.2 : 1.8} fill={C.cream} opacity="0.8" />
      ))}
      <circle cx={196} cy={30} r="18" fill={C.cream} />
      <circle cx={203} cy={25} r="16" fill={C.night} />
      <T x={78} y={30} size={11} fill={C.brass} display>Last orders...</T>
      <rect x={10} y={60} width="104" height="82" rx="8" fill={C.stout2} stroke={C.whiskey2} strokeWidth="2" />
      <rect x={122} y={60} width="108" height="82" rx="8" fill={C.stout2} stroke={C.emerald2} strokeWidth="2" />
      <Person x={40} y={78} color={C.whiskey} s={0.62} />
      <Person x={84} y={78} color={C.whiskey} s={0.62} />
      <T x={62} y={118} size={8.5} weight={600}>Mafia pick a victim</T>
      <T x={62} y={131} size={7.5} fill={C.brass}>ends when they decide</T>
      <Person x={146} y={78} color={C.emerald} s={0.62} />
      <Person x={176} y={78} color={C.blue} s={0.62} />
      <Person x={206} y={78} color={C.mah2} s={0.62} />
      {[146, 176, 206].map((x) => (
        <g key={x} transform={`translate(${x - 4.5} 90) scale(0.45)`}>
          <path d="M0 0h20l-3 22a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3z" fill={C.stout} stroke={C.cream} strokeWidth="2" />
          <path d="M0 0h20l-.8 6H.8z" fill={C.cream} />
        </g>
      ))}
      <T x={176} y={118} size={8.5} weight={600}>Everyone else</T>
      <T x={176} y={131} size={7.5} fill={C.brass}>carry on partying</T>
    </Scene>
  ),

  night: (
    <Scene label="A moon over the pub, with three night actions" bg={C.night}>
      {[[24, 20], [60, 38], [96, 14], [150, 30], [200, 16], [214, 52], [40, 60]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 1.2 : 1.8} fill={C.cream} opacity="0.8" />
      ))}
      <circle cx={190} cy={36} r="20" fill={C.cream} />
      <circle cx={198} cy={30} r="18" fill={C.night} />
      <rect x={18} y={74} width="204" height="60" rx="6" fill={C.stout2} stroke={C.brass} strokeWidth="1.5" opacity="0.9" />
      {[
        ['Mafia', 'pick a victim', C.whiskey2, 52],
        ['Doctor', 'protect one', C.brass, 120],
        ['Detective', 'check one', C.blue, 188],
      ].map(([name, what, col, x]) => (
        <g key={name as string}>
          <circle cx={x as number} cy={96} r="11" fill={col as string} />
          <T x={x as number} y={118} size={9} weight={600}>{name as string}</T>
          <T x={x as number} y={129} size={7.5} fill={C.brass}>{what as string}</T>
        </g>
      ))}
      <T x={72} y={36} size={11} fill={C.brass} display>Last orders...</T>
    </Scene>
  ),

  dawn: (
    <Scene label="Sunrise over the pub with a story scroll" bg="#6b3a22">
      <rect y={96} width="240" height="54" fill={C.stout} />
      <circle cx={120} cy={96} r="34" fill={C.brass} />
      {[...Array(9)].map((_, i) => {
        const a = (Math.PI * (i + 1)) / 10;
        return <line key={i} x1={120 + Math.cos(Math.PI + a) * 40} y1={96 + Math.sin(Math.PI + a) * 40} x2={120 + Math.cos(Math.PI + a) * 52} y2={96 + Math.sin(Math.PI + a) * 52} stroke={C.brass} strokeWidth="3" strokeLinecap="round" />;
      })}
      <path d="M20 96 L20 74 L44 58 L68 74 L68 96Z" fill={C.stout} />
      <rect x={30} y={80} width="10" height="16" fill={C.brass} opacity="0.7" />
      <path d="M172 96 L172 76 L200 76 L200 96Z" fill={C.stout} />
      <rect x={34} y={104} width="172" height="36" rx="8" fill={C.cream} stroke={C.brass} strokeWidth="2" />
      <T x={120} y={119} size={8.5} fill={C.stout} weight={600}>"Seamus stepped out for a smoke</T>
      <T x={120} y={132} size={8.5} fill={C.stout} weight={600}>and never came back."</T>
    </Scene>
  ),

  day: (
    <Scene label="Three friends arguing at the bar">
      <rect y={112} width="240" height="38" fill={C.mah} />
      <rect y={108} width="240" height="8" fill={C.mah2} />
      <Person x={44} y={58} color={C.emerald} s={1} />
      <Person x={120} y={58} color={C.whiskey} s={1} />
      <Person x={196} y={58} color={C.blue} s={1} />
      {[
        [44, 'It was you!'],
        [120, 'Not me!'],
        [196, 'Hmm...'],
      ].map(([x, t]) => (
        <g key={t as string}>
          <rect x={(x as number) - 34} y={10} width="68" height="22" rx="8" fill={C.cream} />
          <path d={`M${(x as number) - 4} 32 l4 8 l4 -8z`} fill={C.cream} />
          <T x={x as number} y={25} size={9} fill={C.stout} weight={600}>{t as string}</T>
        </g>
      ))}
      <T x={120} y={138} size={9} fill={C.brass}>talk it out, face to face</T>
    </Scene>
  ),

  vote: (
    <Scene label="A phone with a vote on it and a ballot box">
      <Phone x={20} y={13}>
        {[
          ['Aoife', false, 34],
          ['Brian', true, 56],
          ['No one', false, 78],
        ].map(([n, on, y]) => (
          <g key={n as string}>
            <rect x={28} y={y as number} width="58" height="17" rx="4" fill={on ? 'rgba(201,162,39,0.3)' : C.stout2} stroke={C.brass} strokeWidth={on ? 2 : 1} />
            <T x={36} y={(y as number) + 12} size={8} anchor="start">{n as string}</T>
            {on && <T x={79} y={(y as number) + 13} size={10} fill={C.brass} anchor="middle">✓</T>}
          </g>
        ))}
        <T x={57} y={112} size={6.5} fill={C.brass}>Calling Time!</T>
      </Phone>
      <rect x={130} y={66} width="86" height="62" rx="6" fill={C.mah2} stroke={C.brass} strokeWidth="2" />
      <rect x={150} y={62} width="46" height="8" rx="3" fill={C.stout} stroke={C.brass} strokeWidth="1.5" />
      <rect x={160} y={30} width="26" height="34" rx="2" fill={C.cream} transform="rotate(-8 173 47)" />
      <T x={173} y={50} size={7} fill={C.stout} weight={700}>Brian</T>
      <T x={173} y={102} size={10} display>VOTES</T>
    </Scene>
  ),

  verdict: (
    <Scene label="A player shown the door, with their role revealed">
      <rect x={20} y={20} width="70" height="112" rx="4" fill={C.mah} stroke={C.brass} strokeWidth="3" />
      <path d="M90 20 L128 32 L128 144 L90 132Z" fill={C.mah2} stroke={C.brass} strokeWidth="2" />
      <circle cx={118} cy={88} r="3" fill={C.brass} />
      <Person x={60} y={66} color={C.whiskey} s={0.9} />
      <rect x={134} y={14} width="86" height="24" rx="4" fill={C.brass} />
      <T x={177} y={31} size={12} fill={C.stout} display>BARRED</T>
      <rect x={140} y={52} width="74" height="70" rx="6" fill={C.whiskey} stroke={C.cream} strokeWidth="2" />
      <T x={177} y={82} size={9} display>They were</T>
      <T x={177} y={100} size={13} display fill={C.cream}>MAFIA!</T>
      <T x={177} y={136} size={7.5} fill={C.brass}>most votes goes out</T>
    </Scene>
  ),

  win: (
    <Scene label="The two ways the game ends">
      <rect x={10} y={12} width="108" height="126" rx="8" fill={C.emerald} opacity="0.85" />
      <rect x={122} y={12} width="108" height="126" rx="8" fill={C.whiskey} opacity="0.9" />
      <T x={64} y={34} size={10} display>VILLAGE WINS</T>
      <T x={176} y={34} size={10} display>MAFIA WIN</T>
      <path d="M44 56h40v20a20 20 0 0 1-40 0z" fill={C.brass} stroke={C.cream} strokeWidth="1.5" />
      <rect x={58} y={96} width="12" height="10" fill={C.brass} />
      <rect x={50} y={106} width="28" height="6" rx="2" fill={C.brass} />
      <T x={64} y={126} size={8}>every Mafia is out</T>
      <circle cx={156} cy={66} r="9" fill={C.cream} /><circle cx={176} cy={66} r="9" fill={C.cream} /><circle cx={196} cy={66} r="9" fill={C.cream} />
      <text x={156} y={70} textAnchor="middle" fontSize="11" fontFamily={DISPLAY} fill={C.whiskey}>M</text>
      <text x={176} y={70} textAnchor="middle" fontSize="11" fontFamily={DISPLAY} fill={C.whiskey}>M</text>
      <text x={196} y={70} textAnchor="middle" fontSize="11" fontFamily={DISPLAY} fill={C.whiskey}>=</text>
      <T x={176} y={100} size={8}>they equal</T>
      <T x={176} y={112} size={8}>everyone else</T>
      <T x={176} y={126} size={7.5} fill={C.brass}>(otherwise, back to night)</T>
    </Scene>
  ),

  ghost: (
    <Scene label="A ghost watching from the bar">
      <rect y={104} width="240" height="46" fill={C.mah} />
      <rect y={100} width="240" height="8" fill={C.mah2} />
      <path d="M96 100 V54 a24 24 0 0 1 48 0 V100 l-8 -8 l-8 8 l-8 -8 l-8 8 l-8 -8z" fill={C.cream} opacity="0.92" />
      <circle cx={110} cy={56} r="4" fill={C.stout} /><circle cx={130} cy={56} r="4" fill={C.stout} />
      <ellipse cx={120} cy={70} rx="5" ry="4" fill={C.stout} />
      <g transform="translate(160 78)">
        <path d="M0 0h20l-3 22a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3z" fill={C.stout} stroke={C.cream} strokeWidth="1.5" />
        <path d="M0 0h20l-.8 6H.8z" fill={C.cream} />
      </g>
      <T x={120} y={22} size={10} fill={C.brass} display>Ghosts at the bar</T>
      <T x={120} y={128} size={9}>You see every role. You can't vote.</T>
      <T x={120} y={141} size={9} fill={C.brass}>No whispering!</T>
    </Scene>
  ),
};

const PANELS: { title: string; text: string; art: ReactNode }[] = [
  {
    title: 'Join the pub',
    text: 'Scan the QR code or type the 4-letter room code, then pick a name. No sign-up, no app. Everyone plays, even the host.',
    art: art.join,
  },
  {
    title: 'Get your card',
    text: 'Press and hold the card to peek at your secret role, then let go. A few Traitors (Mafia) hide among the Villagers. Some games also have a Detective and a Doctor.',
    art: art.cards,
  },
  {
    title: 'Night falls',
    text: 'Everyone picks someone on their phone and taps Lock in. The Mafia choose who to get rid of, the Doctor protects someone, the Detective checks someone. Villagers tap too, so every phone looks the same. (In Simple Mode only the Mafia act.)',
    art: art.night,
  },
  {
    title: 'Dawn',
    text: 'The pub tells the story: who was lost in the night, or that someone was saved. Nobody finds out who did it.',
    art: art.dawn,
  },
  {
    title: 'Talk it out',
    text: 'Face to face, in the room. Accuse, defend, bluff. The timer shows on every phone and the TV, with a warning five minutes before voting.',
    art: art.day,
  },
  {
    title: 'Calling Time',
    text: 'Everyone votes on their phone: tap a name, or "No one". You can change your mind until time is called.',
    art: art.vote,
  },
  {
    title: 'Barred!',
    text: 'The most votes goes out the door and their role is revealed. A tie, or "No one" matching the top vote, means nobody leaves.',
    art: art.verdict,
  },
  {
    title: 'Who wins?',
    text: 'The village wins when every Mafia member is out. The Mafia win when they equal everyone else. Otherwise it is night again.',
    art: art.win,
  },
  {
    title: 'Ghosts at the bar',
    text: 'If you are out, you can still watch the whole board, but you cannot vote or give anything away. No whispering across the table!',
    art: art.ghost,
  },
];

type Mode = 'full' | 'simple';
const at = (i: number) => PANELS[i] as (typeof PANELS)[number];

/** Simple Mode: same story, but only Mafia and Villagers, and only the Mafia act at night. */
const PANELS_SIMPLE: typeof PANELS = [
  at(0),
  {
    title: 'Get your card',
    text: 'Press and hold the card to peek at your secret role, then let go. Simple Mode has only two roles: most of you are Villagers, and a few are Traitors (Mafia). No Detective, no Doctor.',
    art: art.cardsSimple,
  },
  {
    title: 'Night falls',
    text: 'Only the Mafia have to do anything: they pick a victim together and tap Lock in. The night ends once they have decided. Everyone else can keep chatting and eating. Villagers get an optional tap so every phone looks the same.',
    art: art.nightSimple,
  },
  {
    title: 'Dawn',
    text: 'The pub tells the story of who was lost in the night. Nobody finds out who did it. Nobody can be saved in Simple Mode.',
    art: art.dawn,
  },
  at(4),
  at(5),
  at(6),
  {
    title: 'Who wins?',
    text: 'The village wins when every Mafia member is voted out. The Mafia win when they equal everyone else. Otherwise it is night again.',
    art: art.win,
  },
  at(8),
];

export function Storyboard({ mode = 'full' }: { mode?: Mode }) {
  const panels = mode === 'simple' ? PANELS_SIMPLE : PANELS;
  return (
    <ol className="storyboard">
      {panels.map((p, i) => (
        <li className="panel" key={p.title}>
          <span className="panel-num" aria-hidden="true">{i + 1}</span>
          <div className="panel-art">{p.art}</div>
          <h3>{p.title}</h3>
          <p>{p.text}</p>
        </li>
      ))}
    </ol>
  );
}

function Tips({ mode }: { mode: Mode }) {
  return (
    <div className="card tips">
      <h2>Good to know</h2>
      <ul>
        <li>Keep your screen to yourself, especially at night. Turn the brightness down and hold the phone close.</li>
        {mode === 'simple' ? (
          <li>Simple Mode keeps the party going: at night only the Mafia need their phones, so nobody else is held up.</li>
        ) : (
          <li>Everyone taps something at night, whatever their role, so nobody can tell who is who by watching.</li>
        )}
        <li>Need a break or a top-up? The host can pause the game from the host controls.</li>
        <li>If your phone locks or the page refreshes, just reopen the site and you are back in your seat.</li>
      </ul>
    </div>
  );
}

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="tabs guide-tabs" role="tablist" aria-label="Game mode">
      <button role="tab" aria-selected={mode === 'full'} className={mode === 'full' ? 'active' : ''} onClick={() => onChange('full')}>Full game</button>
      <button role="tab" aria-selected={mode === 'simple'} className={mode === 'simple' ? 'active' : ''} onClick={() => onChange('simple')}>Simple mode</button>
    </div>
  );
}

const blurb = (mode: Mode) =>
  mode === 'simple'
    ? 'Just Mafia and Villagers: a plain kill and vote. Only the Mafia act at night, so everyone else can keep partying.'
    : 'Nine scenes, one minute. Nobody sits out: the pub runs the game.';

/** Standalone page at /how-to-play (or /how-to-play?mode=simple): good for a second screen or sharing a link. */
export function GuidePage() {
  const [mode, setMode] = useState<Mode>(new URLSearchParams(location.search).get('mode') === 'simple' ? 'simple' : 'full');
  const change = (m: Mode) => {
    setMode(m);
    history.replaceState(null, '', m === 'simple' ? '?mode=simple' : location.pathname);
  };
  return (
    <div className="guide-page">
      <div className="guide-head">
        <Logo />
        <h1>How to play</h1>
        <ModeTabs mode={mode} onChange={change} />
        <p className="tagline">{blurb(mode)}</p>
        <a className="btn primary" href="/">Join a game</a>
      </div>
      <Storyboard mode={mode} />
      <Tips mode={mode} />
    </div>
  );
}

/** Full-screen overlay opened from inside the app. Closing it returns to exactly where you were. */
export function GuideSheet({ onClose, initialMode = 'full' }: { onClose: () => void; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="sheet-bar">
        <h2>How to play</h2>
        <button className="btn small" onClick={onClose}>Close</button>
      </div>
      <div className="guide-page">
        <ModeTabs mode={mode} onChange={setMode} />
        <p className="tagline center-text">{blurb(mode)}</p>
        <Storyboard mode={mode} />
        <Tips mode={mode} />
        <button className="btn primary big" onClick={onClose}>Back to the game</button>
      </div>
    </div>
  );
}
