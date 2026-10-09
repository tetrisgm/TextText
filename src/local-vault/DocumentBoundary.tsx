"use client";
import { Component, type ReactNode } from "react";

/** Failed readers follow file repairs without remounting healthy editors. */
export class DocumentBoundary extends Component<{
  children: ReactNode;
  revision: string;
  reload: (signal: AbortSignal) => Promise<void>;
}, { error: string }> {
  state = { error: "" };
  private controller: AbortController | null = null;
  private pending = false;
  private mounted = false;
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidMount() {
    this.mounted = true;
    window.addEventListener("texttext:vault-changed", this.changed);
  }
  componentDidUpdate(previous: Readonly<typeof this.props>) {
    if (this.state.error && previous.revision !== this.props.revision) this.setState({ error: "" });
  }
  componentWillUnmount() {
    this.mounted = false;
    this.controller?.abort();
    window.removeEventListener("texttext:vault-changed", this.changed);
  }
  private changed = () => {
    if (!this.state.error || !this.mounted) return;
    this.pending = true;
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    void (async () => {
      do {
        this.pending = false;
        try { await this.props.reload(controller.signal); }
        catch { /* Retain the original error until a later file notification. */ }
      } while (this.pending && this.mounted && this.state.error && !controller.signal.aborted);
    })().finally(() => { if (this.controller === controller) this.controller = null; });
  };
  render() {
    return this.state.error
      ? <div className="vault-notice" role="alert">This TextPack could not be opened: {this.state.error}</div>
      : this.props.children;
  }
}
