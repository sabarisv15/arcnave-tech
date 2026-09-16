import type { Workspace, Source } from "./types";
export const sources: Source[] = [
  {
    id: 1,
    title: "Using trees and vegetation to reduce heat islands",
    domain: "epa.gov",
    url: "https://www.epa.gov/heatislands/using-trees-and-vegetation-reduce-heat-islands",
    type: "Government",
    snippet: "An overview of vegetation as a strategy for reducing urban heat.",
  },
  {
    id: 2,
    title: "Guide to cool roofs",
    domain: "energy.gov",
    url: "https://www.energy.gov/sites/prod/files/guide_to_cool_roofs.pdf",
    type: "Government",
    snippet:
      "How reflective roofs reduce solar heat absorption, with guidance for building owners.",
  },
  {
    id: 3,
    title: "Heat island reduction solutions",
    domain: "epa.gov",
    url: "https://www.epa.gov/heatislands/heat-island-reduction-solutions",
    type: "Government",
    snippet:
      "A range of local strategies, including trees, roofs and policy measures.",
  },
  {
    id: 4,
    title: "Time-evolving impact of trees on street canyon microclimate",
    domain: "arxiv.org",
    url: "https://arxiv.org/abs/2301.09935",
    type: "Academic",
    snippet:
      "A research preprint investigating how tree growth affects street microclimates over time.",
  },
];
export const coolingAnswer = `## A cooler city starts at street level

Trees and vegetation provide shade and contribute to cooling through moisture release. They are one practical part of a broader urban heat strategy. [1](#source-1)

### Three approaches worth combining

**1. Give shade a place in everyday life.** Tree cover can make the spaces between buildings more comfortable. For this example plan, start by assessing exposed walking routes and gathering places. [1](#source-1)

**2. Rethink the surfaces above us.** Reflective roofs absorb less solar heat. Their suitability depends on the building and climate, so evaluate them locally rather than assuming every roof needs the same treatment. [2](#source-2)

**3. Treat cooling as a connected system.** EPA describes a range of interventions, including vegetation, cool surfaces and local policy. The useful question is which combination fits a particular neighborhood. [3](#source-3)

| Approach | What it changes | What to investigate locally |
| --- | --- | --- |
| Tree canopy | Shade and the street environment | Space, maintenance and water |
| Reflective roofs | Solar heat absorption | Building condition and climate |
| A combined plan | Multiple heat pathways | Priorities, cost and ownership |

### What the evidence cannot decide for us

A useful pilot still needs a local baseline, a maintenance plan and a way to compare results. Tree benefits also change as trees grow; the linked preprint explores that time dimension. [4](#source-4)

> Start with one route people use every day. Measure conditions, test an intervention, and learn before expanding.

The pilot recommendation is an illustrative planning judgment, not a finding from a new live investigation.`;
export const report = `# A cooler everyday city

## A neighborhood pilot

The goal is simple: make a familiar walking route more comfortable on hot days.

### 1. Understand the route

- Walk it at different times of day.
- Map existing shade and exposed gathering places.
- Ask residents where the heat changes their routine.

### 2. Choose an intervention

Evaluate tree canopy, suitable reflective roofs and temporary shade. Record maintenance responsibilities alongside installation costs.

### 3. Learn before scaling

Compare conditions before and after. Document weather, time of day and where measurements were taken.

| Milestone | Deliverable |
| --- | --- |
| Baseline | Route map and observations |
| Pilot | One documented intervention |
| Review | Findings and next decision |

## Open questions

Who maintains the intervention? Which locations benefit most? What changes across seasons?

*Illustrative project brief. Local validation is required.*`;
const now = Date.now();
export function initialWorkspace(): Workspace {
  return {
    preferences: {
      name: "You",
      theme: "system",
      font: "sans",
      model: "Auto",
      instructions: "",
      enterToSend: true,
      reducedMotion: false,
      defaultMode: "chat",
      sourceScope: "All sources",
      saveHistory: true,
    },
    projects: [
      {
        id: "p-cities",
        title: "A cooler everyday city",
        description:
          "A small investigation into shade, streets, and more livable neighborhoods.",
        instructions:
          "Separate published evidence from planning recommendations. Prefer primary sources and acknowledge uncertainty.",
        files: [],
        savedSources: [sources[0]],
        updatedAt: now - 3600000,
        demo: true,
      },
      {
        id: "p-writing",
        title: "Notes for a slower Sunday",
        description: "Essays, half-formed ideas, and things worth noticing.",
        instructions:
          "Write with clarity and warmth. Favor concrete details over abstractions.",
        files: [],
        savedSources: [],
        updatedAt: now - 86400000,
        demo: true,
      },
    ],
    chats: [
      {
        id: "c-cities",
        title: "How can cities stay cooler?",
        projectId: "p-cities",
        updatedAt: now - 3600000,
        demo: true,
        messages: [
          {
            id: "u-cities",
            role: "user",
            text: "How can cities stay cooler? Compare the practical approaches and show your sources.",
            mode: "research",
            status: "complete",
          },
          {
            id: "a-cities",
            role: "assistant",
            text: coolingAnswer,
            mode: "research",
            status: "complete",
            researchStage: "complete",
            sources,
            questions: [
              "Compare tree canopy and cool roofs",
              "What should a neighborhood cooling pilot measure?",
              "Turn these findings into a project brief",
            ],
            events: [
              {
                stage: "planning",
                label: "Example question prepared",
                detail: "Compare practical urban cooling approaches.",
                at: 1,
              },
              {
                stage: "reading",
                label: "4 reference records loaded",
                detail:
                  "Curated EPA, Department of Energy and research references.",
                at: 2,
              },
              {
                stage: "complete",
                label: "Example report ready",
                detail: "A saved demonstration, not live research.",
                at: 3,
              },
            ],
            demo: true,
          },
        ],
      },
      {
        id: "c-writing",
        title: "Finding the shape of an idea",
        projectId: "p-writing",
        updatedAt: now - 86400000,
        demo: true,
        messages: [
          {
            id: "u-writing",
            role: "user",
            text: "Help me find a starting point for a short essay about noticing everyday things.",
            mode: "chat",
            status: "complete",
          },
          {
            id: "a-writing",
            role: "assistant",
            text: "Start with something small enough to hold in one sentence.\n\nThe cup left by the window. The same person on the morning train. A tree you only notice when it changes.\n\n**Pick one detail and stay with it.** What did you see first? What did you understand later? The space between those two answers is often where an essay begins.\n\nTry this opening: *“For weeks, I walked past it without looking.”* Then tell us what finally made you stop.",
            mode: "chat",
            status: "complete",
            demo: true,
          },
        ],
      },
    ],
    artifacts: [
      {
        id: "art-brief",
        title: "A cooler everyday city",
        kind: "document",
        versions: [report],
        version: 0,
        updatedAt: now - 3600000,
        projectId: "p-cities",
        chatId: "c-cities",
        demo: true,
      },
      {
        id: "art-code",
        title: "A small place to begin",
        kind: "webpage",
        versions: [
          "<!doctype html><html><head><style>body{font-family:Georgia;background:#f3f4f1;color:#344654;padding:10%;}h1{font-size:clamp(32px,7vw,64px);font-weight:normal}p{line-height:1.8;max-width:420px}</style></head><body><p>FIELD NOTES / 01</p><h1>Make room<br>for a thought.</h1><p>A quiet page. A clear question. Sometimes that is all you need to begin.</p></body></html>",
        ],
        version: 0,
        updatedAt: now - 86400000,
        demo: true,
      },
    ],
  };
}
