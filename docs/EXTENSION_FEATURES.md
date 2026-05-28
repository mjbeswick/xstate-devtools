# XState DevTools: Features & Usage

This document provides an in-depth look at all the features provided by the XState DevTools extension, along with a guide on how to effectively use them to debug your XState v5 applications.

## 1. Extension Features

### 1.1. The DevTools Panel Layout
The extension integrates seamlessly into Chrome DevTools, providing a familiar resizable, collapsible layout typically split into three main areas (or two columns plus a drawer depending on screen width):
- **Actor List:** Displays all running machine instances (actors) in your application. It visualizes the parent-to-child hierarchy when machines spawn or invoke other actors.
- **Machine Tree:** A visual, hierarchical representation of the selected actor's architecture. 
- **Side Panel:** Contextual information and interactive utilities for the currently selected state or actor.

### 1.2. Machine Tree & Source Navigation
When you select an actor, the centerpiece is the Machine Tree:
- **Active State Highlighting:** See exactly which state(s) your machine is in in real-time.
- **Inline Descriptions:** State descriptions defined in your state machine config (e.g. `description: 'Waiting for auth'`) are surface-rendered for quick context.
- **Click-to-Source:** Clicking on a state or machine definition links directly back to your IDE (via `vscode://` links), skipping the manual search. *(Note: Requires the `@xstate-devtools/vite-plugin` to inject source maps during build).*
- **Breadcrumbs:** A breadcrumb trail above the machine tree shows the exact nested path of your current active state.

### 1.3. Event Log & Time Travel
Every event sent to an actor is recorded in real-time:
- **Event Log:** View a chronological list of events dispatched to the selected actor.
- **Time Travel:** Clicking any row in the event log instantly "rewinds" the machine tree and the context viewer to that exact point in time. Debugging past states requires zero application reloading.
- **Back to Live:** Easily snap out of time-travel mode and resume monitoring the live state of the application by clicking "Back to live" in the time-travel banner.

### 1.4. Side Panel Details
The Side Panel provides deep insights, split into multiple collapsible accordion sections:
- **Status & Actor Info:** Shows the current machine status (active, stopped, etc.), session ID, and actor type.
- **Context Viewer:** An interactive JSON tree viewer representing the machine's `context`. It seamlessly updates during live execution and time-travel.
- **Transitions:** View available outgoing transitions from the currently active state, helping you understand *what can happen next*.
- **Send Event:** A dispatch utility allowing you to manually construct and trigger JSON events to the selected actor directly from the DevTools panel to test edge cases.

### 1.5. Server-Side Node.js Actor Inspection
Unlike traditional browser extensions that only see the `window`, XState DevTools natively supports server-side actors:
- Server-rendered Node.js frameworks (like Remix, Next.js, or raw Express APIs) can sync their actors over WebSockets using `createServerAdapter()`.
- Both client-side and server-side actors appear uniformly within the single DevTools pane.

---

## 2. Usage Guide

### Step 1: Install the Extension
*If not installing from the Chrome Web Store:*
1. Build the extension locally: `npm run build --workspace=packages/extension`.
2. Navigate to `chrome://extensions` in Chromium-based browsers.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and select the built `packages/extension/dist` directory.

### Step 2: Instrument your Application
You must connect your application to the DevTools using the provided adapter packages.

**For Browser (Frontend) Actors:**
```ts
import { createAdapter } from '@xstate-devtools/adapter';
import { useMachine } from '@xstate/react';

// Create a persistent inspector
const { inspect } = createAdapter();

// Pass to your machine instantiation
const [state, send] = useMachine(myMachine, { inspect });
```

**For Server (Backend) Actors:**
```ts
import { createServerAdapter } from '@xstate-devtools/adapter/server';
import { createActor } from 'xstate';

// Create websocket bridge adapter
const { inspect } = createServerAdapter();

const actor = createActor(serverMachine, { inspect });
actor.start();
```

### Step 3: Connect via Vite (Optional but Recommended)
To enable the **Click-to-Source** DevTools feature, add the Vite plugin to your `vite.config.ts`:
```ts
import { xstateDevtoolsPlugin } from '@xstate-devtools/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [xstateDevtoolsPlugin()],
});
```

### Step 4: Open the DevTools Pane
1. Open up your running app in the browser.
2. Open Chrome Developer Tools (`F12` or `Ctrl+Shift+I` / `Cmd+Option+I`).
3. Click on the **XState** tab along the top navigation bar.
4. Interact with your application and watch the actors, state transitions, and context populate in real-time!