import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, FileText, Folder, Globe2, Layers3, Menu, MessageSquare, Plus, Search, X } from "lucide-react";
import "./landing.css";

export const publicPaths = new Set(["/", "/about", "/privacy", "/terms"]);
export const cleanPath = (path: string) => path.replace(/\/+$/, "") || "/";
export const siteContact = "admin@arcnave.tech";
function BrandMark() { return <span className="arcnave-mark" aria-hidden="true"><span /><span /><span /></span>; }

const examples = [
  { label: "NAAC / IQAC", icon: Globe2, project: "Institutional quality review", prompt: "Help our IQAC team review these department files. Organise the evidence and flag information that needs updating.", title: "An evidence register to review", kind: "Institutional preparation", body: "Keep the source material close to the draft, so your team can check every detail.", rows: ["Group evidence from department files", "Flag missing or outdated information", "Prepare a working draft for IQAC review"], file: "Institutional evidence register", footer: "Findings → questions → next steps" },
  { label: "NBA programs", icon: FileText, project: "Program accreditation preparation", prompt: "Review our program documents against the applicable NBA manual. Help us identify gaps for faculty review.", title: "A clearer program review", kind: "Program preparation", body: "Work at the program level, using your documents and the applicable manual as context.", rows: ["Keep program records together", "Summarise supporting evidence", "Flag gaps for the program team to verify"], file: "Program evidence summary", footer: "Document → understanding → action" },
  { label: "AICTE preparation", icon: Layers3, project: "Approval document preparation", prompt: "Use the applicable AICTE requirements and our source files to draft a document readiness checklist. Mark anything we need to verify.", title: "Know what needs attention", kind: "Document readiness", body: "Bring the relevant requirements and institutional records into one review conversation.", rows: ["Match requested items to source files", "Identify documents needing attention", "Draft a checklist for administrative review"], file: "Document readiness checklist", footer: "Idea → draft → usable output" },
];

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return <header className="site-header">
    <Link className="site-brand" to="/" aria-label="ArcNave home"><BrandMark /><span>ArcNave<span className="site-brand-period">.</span></span></Link>
    <button className="site-menu-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
    <nav className={`site-nav ${open ? "is-open" : ""}`} aria-label="Website navigation">
      <a href="/#product" onClick={() => setOpen(false)}>Product</a><a href="/#workflow" onClick={() => setOpen(false)}>How it works</a><Link to="/about">About</Link>
      <div className="site-nav-actions"><Link className="site-login" to="/login">Log in</Link><Link className="site-button site-button-small" to="/signup">Get started <ArrowUpRight size={16} /></Link></div>
    </nav>
  </header>;
}

function SiteFooter() {
  return <footer className="site-footer">
    <div className="site-footer-top"><div><Link className="site-brand" to="/"><BrandMark /><span>ArcNave.</span></Link><p>Academic Campus AI.<br />For the work behind a better campus.</p></div><div className="site-footer-links"><Link to="/about">About ArcNave</Link><a href={`mailto:${siteContact}`}>Contact us <ArrowUpRight size={14} /></a><Link to="/privacy">Privacy & data</Link><Link to="/terms">Using ArcNave</Link></div></div>
    <div className="site-footer-bottom"><span>© 2026 ArcNave</span><span>Built in Coimbatore, Tamil Nadu, India</span><span className="site-stage"><i /> Bootstrapped · In development</span></div>
  </footer>;
}

export function ProductPreview() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  return <div className="site-preview" aria-label="Illustrative ArcNave workflow preview">
    <div className="site-preview-bar"><span><span className="site-preview-dot" /> Your campus work, connected</span><span>Product preview</span></div>
    <div className="site-preview-tabs" role="tablist" aria-label="Example workflows">{examples.map((item, index) => <button key={item.label} role="tab" id={`example-tab-${index}`} aria-selected={selected === index} aria-controls="example-panel" onClick={() => setSelected(index)}><item.icon size={15} />{item.label}</button>)}</div>
    <div className="site-preview-body" role="tabpanel" id="example-panel" aria-labelledby={`example-tab-${selected}`}>
      <aside className="site-preview-sidebar" aria-hidden="true"><span className="site-preview-mark"><BrandMark /></span><span><Plus size={16} /></span><span><Search size={16} /></span><span className="active"><MessageSquare size={16} /></span><span><Folder size={16} /></span></aside>
      <div className="site-preview-conversation"><div className="site-preview-project"><Folder size={13} />{example.project}</div><div className="site-preview-prompt">{example.prompt}</div><div className="site-preview-answer"><span className="site-answer-brand"><BrandMark /> ArcNave</span><p>{example.body}</p><div className="site-preview-output"><div className="site-output-heading"><span>{example.kind}</span><ArrowUpRight size={15} /></div><h3>{example.title}</h3><ul>{example.rows.map((row) => <li key={row}><Check size={14} />{row}</li>)}</ul><div className="site-preview-file"><span><FileText size={17} /><strong>{example.file}</strong></span><span>Artifact</span></div></div></div><div className="site-preview-compose"><span>Ask a follow-up…</span><span><ArrowUpRight size={15} /></span></div></div>
    </div><div className="site-preview-caption"><span>Illustrative example · sample content</span><span>{example.footer}</span></div>
  </div>;
}

function HomePage() {
  return <>
    <section className="site-hero">
      <div className="site-hero-copy"><p className="site-eyebrow"><span /> ACADEMIC CAMPUS AI</p><h1>Campus work.<br /><em>A clearer path.</em></h1><p className="site-hero-description">An AI workspace for colleges to organise evidence, review academic documents, and prepare drafts for NAAC, NBA, and AICTE work.</p><div className="site-hero-actions"><Link className="site-button" to="/signup">Get started with ArcNave <ArrowUpRight size={18} /></Link><a className="site-text-link" href="#product">Explore the product <ArrowRight size={17} /></a></div><p className="site-hero-note"><span className="site-stage"><i /> Currently in development</span><span>Built around campus teams.</span></p></div>
      <ProductPreview />
    </section>
    <div className="site-purpose"><span>THE WORK BEHIND<br />CAMPUS QUALITY.</span><p>From scattered records<br />to a reviewable draft.</p><div><span>NAAC</span><span>NBA</span><span>AICTE</span></div></div>
    <section id="product" className="site-section site-product"><div className="site-section-heading"><p className="site-eyebrow">DOCUMENTS. EVIDENCE. ACADEMIC CONTEXT.</p><h2>Campus preparation takes<br />more than a checklist.</h2><p>Bring institutional records, program documents, and applicable requirements into a working context. Prepare material your team can review.</p></div><div className="site-capabilities">
      <article><span className="site-feature-icon"><Globe2 size={24} /></span><p className="site-feature-index">01 / ORGANISE</p><h3>Give your evidence<br />a place to belong.</h3><p>Collect related files in projects. Work through department records and supporting documents without losing context.</p><span className="site-feature-detail">Department files · evidence · projects</span></article>
      <article><span className="site-feature-icon"><FileText size={24} /></span><p className="site-feature-index">02 / REVIEW</p><h3>See what needs<br />a closer look.</h3><p>Ask questions against your source material. Surface inconsistencies and flag gaps for the responsible team to verify.</p><span className="site-feature-detail">Source documents · gaps · follow-ups</span></article>
      <article><span className="site-feature-icon"><Layers3 size={24} /></span><p className="site-feature-index">03 / PREPARE</p><h3>Start with a draft.<br />Finish with judgment.</h3><p>Prepare summaries, evidence registers, and working reports. Refine and export supported outputs for faculty and administrative review.</p><span className="site-feature-detail">Working reports · review · exports</span></article>
    </div></section>
    <section id="workflow" className="site-section site-workflow"><div><p className="site-eyebrow">A PRACTICAL CAMPUS WORKFLOW</p><h2>Bring the records.<br />Build the next draft.</h2><p>Your team knows the institution.<br />ArcNave helps with the preparation.</p><Link className="site-text-link" to="/signup">Open your workspace <ArrowRight size={17} /></Link></div><ol>{[
      ["Bring the requirements and records", "Upload the applicable manual, templates, and supporting institutional or program documents."],
      ["Review evidence and open questions", "Ask for summaries and gaps. Check findings against the source files and current requirements."],
      ["Prepare a draft your team can own", "Refine working reports and checklists, then export supported outputs for human review before submission."],
    ].map(([title, text], index) => <li key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowUpRight size={19} /></li>)}</ol></section>
    <section className="site-section site-audience"><div className="site-section-heading"><p className="site-eyebrow">FOR THE PEOPLE BEHIND THE CAMPUS</p><h2>Different teams.<br />A common body of work.</h2></div><div className="site-audience-grid"><article><span>IQAC & QUALITY TEAMS</span><h3>Keep institutional evidence in view.</h3><p>Organise department inputs, review supporting files, and prepare working summaries for institutional quality processes.</p></article><article><span>HEADS OF DEPARTMENT & FACULTY</span><h3>Prepare at the program level.</h3><p>Work through program records and outcome documentation. Keep evidence and questions together for NBA preparation.</p></article><article><span>MANAGEMENT & ADMINISTRATION</span><h3>Make preparation manageable.</h3><p>Review institutional records and applicable AICTE requirements, with working checklists your team can verify.</p></article></div></section>
    <section className="site-company-strip"><div><p className="site-eyebrow">A SMALL START. A CLEAR PURPOSE.</p><h2>Built in Coimbatore.<br />For the work ahead.</h2></div><div><p>ArcNave is a bootstrapped product being developed in Coimbatore, Tamil Nadu. We’re building Academic Campus AI to help colleges with accreditation preparation, academic documentation, and everyday campus work.</p><Link className="site-text-link" to="/about">Our story so far <ArrowRight size={17} /></Link></div></section>
    <section className="site-section site-faq"><div><p className="site-eyebrow">A FEW GOOD QUESTIONS</p><h2>Before you<br />get started.</h2></div><div>{[
      ["What is ArcNave?", "ArcNave is Academic Campus AI: a software workspace for colleges that brings conversations, source documents, project context, and working drafts together. It is currently in development."],
      ["What can I use it for?", "Organise evidence, review source documents, and prepare working drafts for campus teams. The previews illustrate intended workflows; available tools and exports depend on the product rollout."],
      ["Is ArcNave available yet?", "The product is in development, with a broader release planned for the end of 2026. You can use the signup entry to check access, or contact admin@arcnave.tech about early access."],
      ["How do I access my workspace?", "Use Log in for an existing account or Get started to open the signup form. Authentication takes you to your workspace, where your conversations and projects live."],
      ["Does ArcNave provide accreditation or approval?", "ArcNave helps with preparation and is not affiliated with or endorsed by NAAC, NBA, or AICTE. Institutions must verify current requirements and review every output. Decisions remain with the relevant bodies."],
    ].map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>
    <section className="site-final-cta"><p className="site-eyebrow">START WHERE YOU ARE</p><h2>Give campus work<br />a clearer starting point.</h2><div><Link className="site-button" to="/signup">Get started <ArrowUpRight size={17} /></Link><a className="site-text-link" href={`mailto:${siteContact}`}>Talk to us <ArrowUpRight size={16} /></a></div></section>
  </>;
}

function AboutPage() {
  return <article className="site-document"><p className="site-eyebrow">ABOUT ARCNAVE</p><h1>Built for the work<br />behind campus quality.</h1><p className="site-document-lead">We’re building Academic Campus AI to make institutional documentation and accreditation preparation easier to work through.</p><section><h2>What we’re building</h2><p>ArcNave is an academic software product for colleges, IQAC teams, faculty, and administrators. The product brings conversations, uploaded files, projects, and editable artifacts into one workspace.</p><p>Our focus is the preparation behind campus quality: organising source material, reviewing evidence, and creating drafts for NAAC institutional processes, NBA program accreditation, and AICTE approval-document work. Institutional review remains essential.</p></section><section className="site-facts"><div><span>STATUS</span><strong>In development</strong></div><div><span>STAGE</span><strong>Bootstrapped</strong></div><div><span>BASED IN</span><strong>Coimbatore, Tamil Nadu, India</strong></div><div><span>CONTACT</span><a href={`mailto:${siteContact}`}>{siteContact}</a></div></section><section><h2>Where we’re headed</h2><p>We are working toward a broader release by the end of 2026. Our development focus is a reliable core workspace, clearer file-based workflows, useful outputs, and a consistent experience across desktop and mobile browsers.</p><p>This is a development target, rather than a guaranteed launch date. Product capabilities and access can change as the rollout progresses.</p></section><section><h2>Get in touch</h2><p>For product questions, early access, or business enquiries, email <a href={`mailto:${siteContact}`}>{siteContact}</a>.</p></section><Link className="site-button" to="/signup">Explore ArcNave <ArrowUpRight size={17} /></Link></article>;
}

function DataPage() {
  return <article className="site-document"><p className="site-eyebrow">PRIVACY & DATA</p><h1>Your work.<br />Clearer choices.</h1><p className="site-document-lead">An overview of how the current ArcNave product handles account and workspace data.</p><section><h2>Account and workspace information</h2><p>ArcNave uses an email address and password to create and authenticate an account. Your conversations, uploaded files, project materials, artifacts, and settings are stored on the ArcNave service so you can return to your work.</p></section><section><h2>AI processing</h2><p>To produce an answer, relevant prompts, conversation context, and file content may be sent to the configured AI provider. Provider availability and enabled tools depend on the workspace configuration. Avoid uploading sensitive information unless you have the right to share it for this processing.</p></section><section><h2>Sharing and account controls</h2><p>Public links you choose to create can be viewed by anyone who has the link. The workspace includes controls for exporting account data, managing public links, and deleting an account. Removing a public link cannot remove copies someone has already made.</p></section><section><h2>Questions about your data</h2><p>Email <a href={`mailto:${siteContact}`}>{siteContact}</a> for questions about data handling or your account. We will update this overview as the product develops.</p></section><p className="site-document-date">Last updated: 27 September 2026</p></article>;
}

function UsePage() {
  return <article className="site-document"><p className="site-eyebrow">USING ARCNAVE</p><h1>A helpful workspace.<br />Human judgment required.</h1><p className="site-document-lead">Practical information for using the development-stage product.</p><section><h2>Development-stage access</h2><p>ArcNave is currently being developed. Features, model availability, usage limits, and account access may change during the rollout. No pricing or service-level guarantee is stated on this website.</p></section><section><h2>Review the output</h2><p>AI responses and generated files can contain errors. You are responsible for reviewing outputs before using them, publishing them, or making decisions from them. Check important facts against reliable sources.</p></section><section><h2>Use material you can share</h2><p>Only upload documents and information that you are permitted to use and share with the service and its configured AI providers. Keep your account credentials private.</p></section><section><h2>Contact</h2><p>For product, access, or usage questions, email <a href={`mailto:${siteContact}`}>{siteContact}</a>. We welcome questions and feedback while the product is in development.</p></section></article>;
}

export default function PublicSite() {
  const { pathname } = useLocation();
  const route = cleanPath(pathname);
  useEffect(() => { if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView(); else window.scrollTo(0, 0); document.title = route === "/" ? "ArcNave — Academic Campus AI" : route === "/about" ? "About ArcNave — Built in Coimbatore" : route === "/privacy" ? "Privacy & data — ArcNave" : "Using ArcNave — Product guidance"; }, [route]);
  return <div className="public-site"><a className="site-skip" href="#site-main">Skip to content</a><SiteHeader /><main id="site-main">{route === "/about" ? <AboutPage /> : route === "/privacy" ? <DataPage /> : route === "/terms" ? <UsePage /> : <HomePage />}</main><SiteFooter /></div>;
}
