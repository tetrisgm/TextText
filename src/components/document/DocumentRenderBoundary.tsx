"use client";

import { Component, Suspense, type ReactNode } from "react";

function RenderFailure() {
  return <p role="status">This item could not be displayed.</p>;
}

/** One boundary per item keeps a failed card from replacing its neighbours.
 * Suspense supplies the same fallback for server rendering, where React error
 * boundaries do not catch. No exception details or untrusted content escape. */
export class DocumentRenderBoundary extends Component<{
  document: unknown;
  template: unknown;
  children: ReactNode;
}, { failed: boolean; document: unknown; template: unknown }> {
  state = { failed: false, document: this.props.document, template: this.props.template };

  static getDerivedStateFromProps(props: DocumentRenderBoundary["props"], state: DocumentRenderBoundary["state"]) {
    if (props.document !== state.document || props.template !== state.template) {
      return { failed: false, document: props.document, template: props.template };
    }
    return null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <RenderFailure />;
    return <Suspense fallback={<RenderFailure />}>{this.props.children}</Suspense>;
  }
}
