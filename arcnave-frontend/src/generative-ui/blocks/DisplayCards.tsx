/**
 * Display cards (ADR-0048): native cards drawn from a display tool's arguments. The server has
 * already checked each card's shape; these still treat every value as untrusted text, and open
 * only http(s) links and images.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Bar,
  BarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Lightbulb, Mail, MessageSquare, Minus, Plus, Timer } from 'lucide-react';
import type { DisplayBlock } from '../types';
import { BAR_GAP, BAR_RADIUS, CHART_AXIS, CHART_GRID, CHART_TEXT, CHART_TOOLTIP_STYLE, seriesColor } from '../../chartColors';

type Rec = Record<string, unknown>;
interface Photo {
  thumbnailUrl: string;
  imageUrl: string;
  sourceUrl: string;
  title?: string;
}

const httpUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = <T = Rec,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function Photos({ photos, label }: { photos: Photo[]; label: string }) {
  const shown = photos.filter((p) => httpUrl(p.thumbnailUrl));
  if (!shown.length) return null;
  return (
    <div className="dc-photos">
      {shown.map((p) => (
        <a key={p.thumbnailUrl} href={httpUrl(p.sourceUrl) ? p.sourceUrl : p.thumbnailUrl} target="_blank" rel="noopener noreferrer">
          <img src={p.thumbnailUrl} alt={p.title || label} loading="lazy" referrerPolicy="no-referrer" />
        </a>
      ))}
    </div>
  );
}

function OutLink({ url, children }: { url: unknown; children: React.ReactNode }) {
  if (!httpUrl(url)) return <>{children}</>;
  return (
    <a className="dc-link" href={url} target="_blank" rel="noopener noreferrer">
      {children}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

/* --------------------------------------------------------------------------------- chart */

// Series colours are the brand's six chart tokens in their fixed order (src/chartColors.ts).

function ChartCard({ d }: { d: Rec }) {
  const style = str(d.style) as 'line' | 'bar' | 'scatter';
  const series = arr(d.series).slice(0, 12);
  const x = (d.x_axis ?? {}) as Rec;
  const y = (d.y_axis ?? {}) as Rec;
  const labels = arr<string>(x.data);
  const color = (s: Rec, i: number) => (typeof s.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(s.color) ? s.color : seriesColor(i));
  const name = (s: Rec, i: number) => str(s.name) || `Series ${i + 1}`;
  const domain = (a: Rec, bar = false): [number | 'auto', number | 'auto'] =>
    bar ? [0, typeof a.max === 'number' ? a.max : 'auto'] : [typeof a.min === 'number' ? a.min : 'auto', typeof a.max === 'number' ? a.max : 'auto'];
  const yScale = y.scale === 'log' ? 'log' : 'auto';
  // BS-PartsB: two or more series always get a legend.
  const legend = series.length > 1 || series.some((s) => typeof s.name === 'string');

  const rows = useMemo(() => {
    const n = Math.max(labels.length, ...series.map((s) => arr<number>(s.values).length));
    return Array.from({ length: n }, (_, i) => {
      const row: Rec = { x: labels[i] ?? String(i + 1) };
      series.forEach((s, j) => (row[`s${j}`] = arr<number>(s.values)[i]));
      return row;
    });
  }, [labels, series]);

  const axes = (bar = false) => (
    <>
      <CartesianGrid stroke={CHART_GRID} vertical={false} />
      <XAxis dataKey="x" stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} label={str(x.title) ? { value: str(x.title), position: 'insideBottom', offset: -4, fontSize: 12 } : undefined} />
      <YAxis
        stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }}
        fontSize={12}
        scale={yScale}
        domain={domain(y, bar)}
        allowDataOverflow={typeof y.min === 'number' || typeof y.max === 'number'}
        label={str(y.title) ? { value: str(y.title), angle: -90, position: 'insideLeft', fontSize: 12 } : undefined}
      />
      <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
      {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  return (
    <div className="dc-card dc-chart" role="figure" aria-label={str(d.title) || 'Chart'}>
      {str(d.title) && <h4 className="dc-title">{str(d.title)}</h4>}
      <div className="dc-chart-body">
        <ResponsiveContainer width="100%" height={300}>
          {style === 'scatter' ? (
            <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid stroke={CHART_GRID} />
              <XAxis type="number" dataKey="x" stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} domain={domain(x)} scale={x.scale === 'log' ? 'log' : 'auto'} name={str(x.title) || 'x'} />
              <YAxis type="number" dataKey="y" stroke={CHART_AXIS} tick={{ fill: CHART_TEXT }} fontSize={12} domain={domain(y)} scale={yScale} name={str(y.title) || 'y'} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              {legend && <Legend wrapperStyle={{ fontSize: 12 }} />}
              {series.map((s, i) => (
                <Scatter key={i} name={name(s, i)} data={arr(s.points).slice(0, 2000)} fill={color(s, i)} />
              ))}
            </ScatterChart>
          ) : style === 'bar' ? (
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 16, left: 0 }} barGap={BAR_GAP}>
              {axes(true)}
              {series.map((s, i) => (
                <Bar key={i} dataKey={`s${i}`} name={name(s, i)} fill={color(s, i)} radius={BAR_RADIUS} />
              ))}
            </BarChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              {axes()}
              {series.map((s, i) => (
                <Line key={i} type="monotone" dataKey={`s${i}`} name={name(s, i)} stroke={color(s, i)} strokeWidth={2} dot={rows.length <= 30} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------ shopping */

function ComparisonCard({ d }: { d: Rec }) {
  const products = arr(d.products);
  const labels = [...new Set(products.flatMap((p) => arr(p.attributes).map((a) => str(a.label))))];
  return (
    <div className="dc-card dc-compare" role="region" aria-label={str(d.summary) || 'Comparison'}>
      <div className="dc-table-wrap">
        <table className="dc-table">
          <thead>
            <tr>
              <th />
              {products.map((p, i) => (
                <th key={i}>
                  <OutLink url={p.url}>{str(p.name)}</OutLink>
                  {str(p.price) && <span className="dc-price">{str(p.price)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {products.map((p, i) => (
                  <td key={i}>{str(arr(p.attributes).find((a) => str(a.label) === label)?.value) || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductBody({ p, photos }: { p: Rec; photos: Photo[] }) {
  return (
    <>
      <Photos photos={photos} label={str(p.name)} />
      <div className="dc-product-head">
        <strong className="dc-name">
          <OutLink url={p.url}>{str(p.name)}</OutLink>
        </strong>
        {str(p.price) && <span className="dc-price">{str(p.price)}</span>}
      </div>
      {str(p.blurb) && <p className="dc-text">{str(p.blurb)}</p>}
    </>
  );
}

function FeaturedCard({ d }: { d: Rec }) {
  const p = arr(d.products)[0] ?? {};
  return (
    <div className="dc-card dc-featured" role="region" aria-label={str(d.summary) || str(p.name)}>
      <span className="dc-eyebrow">Top pick</span>
      <ProductBody p={p} photos={arr<Photo[]>(d.photos)[0] ?? []} />
    </div>
  );
}

function ProductCarousel({ d }: { d: Rec }) {
  const products = arr(d.products);
  const [page, setPage] = useState(0);
  const p = products[page] ?? {};
  return (
    <div className="dc-card dc-carousel" role="region" aria-roledescription="carousel" aria-label={str(d.summary) || 'Products'}>
      <ProductBody p={p} photos={arr<Photo[]>(d.photos)[page] ?? []} />
      {products.length > 1 && (
        <div className="dc-pager">
          <button type="button" aria-label="Previous product" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={16} />
          </button>
          <span>
            {page + 1} / {products.length}
          </span>
          <button type="button" aria-label="Next product" disabled={page === products.length - 1} onClick={() => setPage(page + 1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------- places, trips */

function PlacesList({ d }: { d: Rec }) {
  const photos = arr<Photo[]>(d.photos);
  return (
    <div className="dc-card dc-places" role="region" aria-label={str(d.summary) || 'Places'}>
      {arr(d.places).map((p, i) => (
        <div key={i} className="dc-place">
          <Photos photos={photos[i] ?? []} label={str(p.name)} />
          <strong className="dc-name">{str(p.name)}</strong>
          {str(p.description) && <p className="dc-text">{str(p.description)}</p>}
          {arr<string>(p.tips).length > 0 && (
            <div className="dc-chips">
              {arr<string>(p.tips).map((t) => (
                <span key={t} className="dc-chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ItineraryCard({ d }: { d: Rec }) {
  const days = arr(d.days);
  const [day, setDay] = useState(0);
  const current = days[day] ?? {};
  return (
    <div className="dc-card dc-itinerary" role="region" aria-label={str(d.summary) || str(d.title) || 'Itinerary'}>
      {str(d.title) && <h4 className="dc-title">{str(d.title)}</h4>}
      <div className="dc-tabs" role="tablist">
        {days.map((x, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === day} className={i === day ? 'is-active' : ''} onClick={() => setDay(i)}>
            {str(x.day_label)}
          </button>
        ))}
      </div>
      <ol className="dc-stops">
        {arr(current.stops).map((s, i) => (
          <li key={i}>
            {str(s.time) && <span className="dc-time">{str(s.time)}</span>}
            <div>
              <strong>{str(s.name)}</strong>
              {str(s.blurb) && <p className="dc-text">{str(s.blurb)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------------- links */

function LinkPreview({ d }: { d: Rec }) {
  return (
    <div className="dc-links" role="region" aria-label={str(d.summary) || 'Links'}>
      {arr(d.links)
        .filter((l) => httpUrl(l.url))
        .map((l, i) => (
          <a key={i} className="dc-card dc-link-card" href={l.url as string} target="_blank" rel="noopener noreferrer">
            <span className="dc-domain">{str(l.domain) || domainOf(l.url as string)}</span>
            <strong>{str(l.title)}</strong>
            {str(l.snippet) && <span className="dc-text">{str(l.snippet)}</span>}
          </a>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------ message */

function MessageCompose({ d }: { d: Rec }) {
  const variants = arr(d.variants);
  const [i, setI] = useState(0);
  const v = variants[i] ?? {};
  const kind = str(d.kind);
  const body = str(v.body);
  const subject = str(v.subject);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [i]);
  const open =
    kind === 'email'
      ? `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : kind === 'textMessage'
        ? `sms:?&body=${encodeURIComponent(body)}`
        : null;
  return (
    <div className="dc-card dc-message" role="region" aria-label={str(d.summary_title) || 'Draft message'}>
      {str(d.summary_title) && <h4 className="dc-title">{str(d.summary_title)}</h4>}
      {variants.length > 1 && (
        <div className="dc-tabs" role="tablist">
          {variants.map((x, j) => (
            <button key={j} type="button" role="tab" aria-selected={j === i} className={j === i ? 'is-active' : ''} onClick={() => setI(j)}>
              {str(x.label)}
            </button>
          ))}
        </div>
      )}
      {kind === 'email' && subject && (
        <p className="dc-subject">
          <span>Subject</span> {subject}
        </p>
      )}
      <p className="dc-body">{body}</p>
      <div className="dc-actions">
        <button
          type="button"
          className="button"
          onClick={() => {
            copy(kind === 'email' && subject ? `Subject: ${subject}\n\n${body}` : body);
            setCopied(true);
          }}
        >
          <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
        {open && (
          <a className="button" href={open}>
            {kind === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />} {kind === 'email' ? 'Open in Mail' : 'Open in Messages'}
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ options, steps */

function OptionsCard({ d }: { d: Rec }) {
  return (
    <div className="dc-card dc-options" role="region" aria-label={str(d.summary) || str(d.title) || 'Options'}>
      {str(d.title) && <h4 className="dc-title">{str(d.title)}</h4>}
      <p className="dc-note">General information, not medical advice. See a professional for your situation.</p>
      <div className="dc-option-grid">
        {arr(d.options).map((o, i) => (
          <div key={i} className="dc-option">
            <strong>{str(o.title)}</strong>
            <p className="dc-text">{str(o.description)}</p>
            <ul>
              {arr<string>(o.bullets).map((b, j) => (
                <li key={j}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepCard({ d }: { d: Rec }) {
  const steps = arr(d.steps);
  const [list, setList] = useState(str(d.view) === 'list');
  const [i, setI] = useState(0);
  const shown = list ? steps : steps.slice(i, i + 1);
  const offset = list ? 0 : i;
  return (
    <div className="dc-card dc-steps" role="region" aria-label={str(d.summary) || 'Steps'}>
      <ol className="dc-step-list" start={offset + 1}>
        {shown.map((s, j) => (
          <li key={offset + j}>
            <span className="dc-step-no">{offset + j + 1}</span>
            <div>
              <strong>{str(s.title)}</strong>
              <p className="dc-text">{str(s.description)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="dc-pager">
        {!list && (
          <>
            <button type="button" aria-label="Previous step" disabled={i === 0} onClick={() => setI(i - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span>
              Step {i + 1} of {steps.length}
            </span>
            <button type="button" aria-label="Next step" disabled={i === steps.length - 1} onClick={() => setI(i + 1)}>
              <ChevronRight size={16} />
            </button>
          </>
        )}
        <button type="button" className="dc-toggle" onClick={() => setList(!list)}>
          {list ? 'One at a time' : 'Show all'}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------------- quiz */

function QuizCard({ d }: { d: Rec }) {
  const questions = arr(d.questions);
  const [mode, setMode] = useState(str(d.initial_mode) === 'flashcards' ? 'flashcards' : 'quiz');
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [hint, setHint] = useState(false);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setHint(false);
    setFlipped(false);
  }, [i, mode]);
  const q = questions[i] ?? {};
  const correct = str(q.correct_option_id);
  const answer = picked[i];
  const done = Object.keys(picked).length === questions.length;
  const score = questions.filter((x, j) => picked[j] === str(x.correct_option_id)).length;
  const correctText = str(arr(q.options).find((o) => str(o.id) === correct)?.text);

  return (
    <div className="dc-card dc-quiz" role="region" aria-label={str(d.title) || 'Quiz'}>
      <div className="dc-quiz-head">
        <div>
          <h4 className="dc-title">{str(d.title)}</h4>
          {str(d.description) && <p className="dc-text">{str(d.description)}</p>}
        </div>
        <div className="dc-tabs" role="tablist">
          {(['quiz', 'flashcards'] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>
              {m === 'quiz' ? 'Quiz' : 'Flashcards'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'quiz' ? (
        <>
          <p className="dc-question">{str(q.prompt)}</p>
          <div className="dc-answers">
            {arr(q.options).map((o) => {
              const id = str(o.id);
              const state = answer === undefined ? '' : id === correct ? 'is-correct' : id === answer ? 'is-wrong' : '';
              return (
                <button key={id} type="button" className={`dc-answer ${state}`} disabled={answer !== undefined} onClick={() => setPicked({ ...picked, [i]: id })}>
                  {str(o.text)}
                </button>
              );
            })}
          </div>
          {answer === undefined && str(q.hint) && (
            <button type="button" className="dc-toggle" onClick={() => setHint(!hint)}>
              <Lightbulb size={13} /> {hint ? str(q.hint) : 'Hint'}
            </button>
          )}
          {answer !== undefined && (
            <p className="dc-explain">
              <strong>{answer === correct ? str(q.correct_feedback) || 'Correct' : str(q.incorrect_feedback) || 'Not quite'}</strong> {str(q.explanation)}
            </p>
          )}
        </>
      ) : (
        <button type="button" className="dc-flashcard" onClick={() => setFlipped(!flipped)} aria-label={flipped ? 'Show question' : 'Show answer'}>
          {flipped ? (
            <>
              <strong>{correctText}</strong>
              <span className="dc-text">{str(q.explanation)}</span>
            </>
          ) : (
            <span>{str(q.prompt)}</span>
          )}
        </button>
      )}

      <div className="dc-pager">
        <button type="button" aria-label="Previous question" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span>
          {i + 1} / {questions.length}
          {mode === 'quiz' && done ? ` · Score ${score}/${questions.length}` : ''}
        </span>
        <button type="button" aria-label="Next question" disabled={i === questions.length - 1} onClick={() => setI(i + 1)}>
          <ChevronRight size={16} />
        </button>
        {mode === 'quiz' && done && (
          <button
            type="button"
            className="dc-toggle"
            onClick={() => {
              setPicked({});
              setI(0);
            }}
          >
            Retake
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------- recipe */

const UNIT: Record<string, string> = { fl_oz: 'fl oz' };

/** An amount scaled to the servings, in a cook's precision. */
export function scaledAmount(amount: number, base: number, servings: number): string {
  const v = (amount * servings) / (base || 1);
  if (!Number.isFinite(v)) return '';
  if (v >= 10) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

function RecipeCard({ d }: { d: Rec }) {
  const base = typeof d.base_servings === 'number' && d.base_servings > 0 ? d.base_servings : 4;
  const [servings, setServings] = useState(base);
  const ingredients = arr(d.ingredients);
  const amountOf = (id: string) => {
    const ing = ingredients.find((x) => str(x.id) === id);
    if (!ing || typeof ing.amount !== 'number') return null;
    const unit = str(ing.unit);
    return `${scaledAmount(ing.amount, base, servings)}${unit ? ` ${UNIT[unit] ?? unit}` : ''} ${str(ing.name)}`.trim();
  };
  const withAmounts = (text: string) =>
    text.split(/(\{[^{}]+\})/g).map((part, i) => {
      const m = /^\{([^{}]+)\}$/.exec(part);
      const a = m ? amountOf(m[1]!) : null;
      return a ? (
        <strong key={i} className="dc-amount">
          {a}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      );
    });
  const minutes = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

  return (
    <div className="dc-card dc-recipe" role="region" aria-label={str(d.title) || 'Recipe'}>
      <h4 className="dc-title">{str(d.title)}</h4>
      {str(d.description) && <p className="dc-text">{str(d.description)}</p>}
      <div className="dc-servings">
        <span>Servings</span>
        <button type="button" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => setServings(servings - 1)}>
          <Minus size={14} />
        </button>
        <strong>{servings}</strong>
        <button type="button" aria-label="More servings" onClick={() => setServings(servings + 1)}>
          <Plus size={14} />
        </button>
      </div>
      <ul className="dc-ingredients">
        {ingredients.map((x) => (
          <li key={str(x.id)}>{amountOf(str(x.id))}</li>
        ))}
      </ul>
      <ol className="dc-step-list">
        {arr(d.steps).map((s, i) => (
          <li key={str(s.id) || i}>
            <span className="dc-step-no">{i + 1}</span>
            <div>
              <strong>{str(s.title)}</strong>
              {typeof s.timer_seconds === 'number' && (
                <span className="dc-chip">
                  <Timer size={12} /> {minutes(s.timer_seconds)}
                </span>
              )}
              <p className="dc-text">{withAmounts(str(s.content))}</p>
            </div>
          </li>
        ))}
      </ol>
      {str(d.notes) && <p className="dc-note">{str(d.notes)}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- translation */

function TranslationCard({ d }: { d: Rec }) {
  const [text, setText] = useState(str(d.translation));
  const [copied, setCopied] = useState(false);
  return (
    <div className="dc-card dc-translation" role="region" aria-label={str(d.summary) || 'Translation'}>
      <div className="dc-translation-side">
        <span className="dc-eyebrow">{str(d.source_language)}</span>
        <p lang={str(d.source_lang) || undefined}>{str(d.source_text)}</p>
      </div>
      <div className="dc-translation-side">
        <span className="dc-eyebrow">{str(d.target_language)}</span>
        <textarea
          lang={str(d.target_lang) || undefined}
          value={text}
          aria-label={`Translation into ${str(d.target_language)}`}
          onChange={(e) => {
            setText(e.target.value);
            setCopied(false);
          }}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
        />
        {str(d.pronunciation) && <p className="dc-text">{str(d.pronunciation)}</p>}
        <div className="dc-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              copy(text);
              setCopied(true);
            }}
          >
            <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}

const CARDS: Record<string, (props: { d: Rec }) => React.ReactElement> = {
  chart_display_v0: ChartCard,
  comparison_card_display_v0: ComparisonCard,
  featured_card_display_v0: FeaturedCard,
  itinerary_display_v0: ItineraryCard,
  link_preview_display_v0: LinkPreview,
  message_compose_v1: MessageCompose,
  options_card_display_v0: OptionsCard,
  places_list_display_v0: PlacesList,
  product_carousel_display_v0: ProductCarousel,
  quiz_display_v0: QuizCard,
  recipe_display_v0: RecipeCard,
  step_card_display_v0: StepCard,
  translation_display_v0: TranslationCard,
};

/** A card this build does not know is shown by its summary rather than dropped. */
export function DisplayCard({ block }: { block: DisplayBlock }) {
  const Card = CARDS[block.tool];
  if (!Card) return str(block.data.summary) ? <p className="dc-note">{str(block.data.summary)}</p> : null;
  return (
    <div className="dc" data-card={block.tool}>
      <Card d={block.data} />
    </div>
  );
}
