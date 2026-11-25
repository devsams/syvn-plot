/**
 * First-visit tutorial, built the same way as SyvnAI's app tour (driver.js,
 * progress, close anytime, replay from the sidebar). It walks the home page,
 * opens a sample experiment if no graph is showing, then tours the graph tools.
 */
import { driver, type Config, type DestroyReason, type Driver, type DriveStep } from "driver.js"

import "driver.js/dist/driver.css"

const DONE_KEY = "syvnplot.tour.completed"
const AUTO_KEY = "syvnplot.tour.autoStarted"
export const START_TOUR_EVENT = "syvnplot:start-tour"

export type TourOptions = {
  /** Loads a sample experiment so the graph steps have something to show. */
  ensureGraph: () => Promise<void> | void
}

const isDesktop = () => window.matchMedia("(min-width: 901px)").matches

/** The live-controls row above the charts (an A2UI Row, so found by its contents). */
function controlsRow(): Element {
  const type = document.querySelector(".surface .ctl")
  const exp = document.querySelector(".surface .export-ctl")
  let el = type?.parentElement ?? null
  while (el && exp && !el.contains(exp)) el = el.parentElement
  return el ?? document.querySelector(".surface") ?? document.body
}

function waitFor(selector: string, timeoutMs = 6000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = () => {
      if (document.querySelector(selector)) return resolve(true)
      if (performance.now() - start > timeoutMs) return resolve(false)
      requestAnimationFrame(tick)
    }
    tick()
  })
}

function steps(opts: TourOptions, d: () => Driver): DriveStep[] {
  const desktop = isDesktop()
  const list: DriveStep[] = [
    {
      popover: {
        title: "Welcome to Syvn Plot",
        description: "Lab data in, publication-ready graphs and statistics out. This quick tour shows you around — use Next to continue, or close it anytime.",
        side: "bottom",
        align: "center",
      },
    },
  ]
  if (desktop)
    list.push({
      element: '[data-tour="nav"]',
      popover: { title: "Get around", description: "Start a new graph, upload a file, browse sample experiments or search — all from this rail.", side: "right", align: "start" },
      skipMissingElement: true,
    })
  list.push(
    {
      element: '[data-tour="upload"]',
      popover: {
        title: "Say what you want to see",
        description: "Click a chip to change it, then Build graph. Or drop a CSV or Excel sheet anywhere on the page — it's read in your browser, never uploaded.",
        side: "bottom",
        align: "center",
      },
      skipMissingElement: true,
    },
    {
      element: () => document.querySelector('[data-tour="samples"] .sample-group') ?? document.querySelector('[data-tour="samples"]') ?? document.body,
      popover: { title: "Sample experiments", description: "No data handy? There's a realistic example for every analysis, each describing the experiment it comes from.", side: "top", align: "start" },
      skipMissingElement: true,
    },
    {
      element: '[data-tour="search"]',
      popover: { title: "Search anything", description: "Find a test (“Mann–Whitney”), a graph (“violin”), an assay (“IC50”) or a feature (“export PDF”). Press ⌘K or / from anywhere.", side: "bottom", align: "end" },
      skipMissingElement: true,
    },
  )
  list.push(
    {
      popover: {
        title: "Let's make a graph",
        description: "Click Next and we'll open a sample experiment (tumour volume in four treatment arms) to show you the graph tools.",
        side: "bottom",
        align: "center",
        onNextClick: async () => {
          if (!document.querySelector(".surface .test-ctl")) {
            await opts.ensureGraph()
            await waitFor(".surface .test-ctl")
          }
          document.querySelector(".canvas")?.scrollTo({ top: 0 })
          d().moveNext()
        },
      },
    },
    {
      element: '[data-tour="analysis"]',
      popover: { title: "The analysis", description: "Change the analysis here anytime (● marks the ones that fit your columns). Column choices live under “Columns & options” just below.", side: "bottom", align: "start" },
      skipMissingElement: true,
    },
    {
      element: controlsRow,
      popover: { title: "Graph controls", description: "Switch the graph style, error bars and axis scales, filter out groups, or export. Everything updates instantly.", side: "bottom", align: "start" },
    },
    {
      element: ".surface .test-ctl",
      popover: { title: "Pick your test", description: "Choose the statistical test and multiple-comparisons method from the dropdowns — t tests, ANOVA, Mann–Whitney, Kruskal–Wallis, Tukey, Dunnett and more. No AI needed.", side: "bottom", align: "start" },
      skipMissingElement: true,
    },
    {
      element: ".surface .chart-actions",
      popover: { title: "Make it yours", description: "Edit labels and any text on the graph, change colours, view full screen, and download as PDF, SVG or PNG at journal and slide sizes.", side: "bottom", align: "end" },
      skipMissingElement: true,
    },
    {
      element: ".surface .stats",
      popover: { title: "The statistics", description: "Descriptive stats, the test result and every pairwise comparison — plus normality and outlier checks.", side: "top", align: "start" },
      skipMissingElement: true,
    },
    {
      element: ".surface .figure-text",
      popover: { title: "Legend and methods", description: "A figure legend and statistical-methods paragraph, written from your results — ready to paste into a paper.", side: "top", align: "start" },
      skipMissingElement: true,
    },
    {
      element: '[data-tour="assistant"]',
      popover: { title: "Optional AI assistant", description: "With your own Gemini, OpenAI or Claude key, ask for changes in plain words, get test advice, clean messy data and draft a results summary. It only runs when you click.", side: "left", align: "start" },
      skipMissingElement: true,
    },
  )
  list.push({
    element: desktop ? '[data-tour="replay"]' : undefined,
    popover: { title: "That's it!", description: desktop ? "Replay this tour anytime from here. Happy plotting!" : "Happy plotting!", side: "right", align: "end" },
    skipMissingElement: true,
  })
  return list
}

/** Removes driver.js leftovers (overlay, popover, body classes) after an interrupted tour. */
export function cleanupDriverDom() {
  document.body.classList.remove("driver-active", "driver-fade", "driver-simple", "driver-no-scroll")
  document.documentElement.classList.remove("driver-no-scroll")
  for (const el of document.querySelectorAll("svg.driver-overlay, .driver-popover, #driver-dummy-element, .driver-dummy-element")) el.remove()
}

export function runTour(opts: TourOptions): Driver {
  let instance: Driver
  const config: Config = {
    showProgress: true,
    animate: true,
    allowClose: true,
    overlayOpacity: 0.5,
    overlayClickBehavior: "close",
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: "sp-tour",
    steps: steps(opts, () => instance),
    onDestroyed: (_el, _step, o) => {
      cleanupDriverDom()
      if ((o.reason as DestroyReason | undefined) === "done") {
        try {
          localStorage.setItem(DONE_KEY, new Date().toISOString())
        } catch {
          /* private window: the tour may show again next visit */
        }
      }
    },
  }
  instance = driver(config)
  instance.drive()
  return instance
}

let autoDecision: boolean | undefined

/** Auto-start once per session until the tour has been finished (same rule as SyvnAI). Decided once per page load, so React StrictMode's double effect doesn't swallow it. */
export function shouldAutoStart(): boolean {
  if (autoDecision !== undefined) return autoDecision
  try {
    autoDecision = !localStorage.getItem(DONE_KEY) && !localStorage.getItem("benchplot.tour.completed") /* old app name */ && !sessionStorage.getItem(AUTO_KEY)
    if (autoDecision) sessionStorage.setItem(AUTO_KEY, "1")
  } catch {
    autoDecision = false
  }
  return autoDecision
}

export const replayTour = () => window.dispatchEvent(new CustomEvent(START_TOUR_EVENT))
