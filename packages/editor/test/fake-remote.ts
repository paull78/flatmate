import { applyPatch, emptyDocument, execute, toStored, type Command, type Document } from "@fm/domain";
import {
  buildExpectations, patchWrites, stampVersions, uniqueKeys, unwrap, type Changeset, type RejectReason, type VersionMap,
} from "@fm/protocol";
import type { ServerEvent } from "../src/ports/events";
import { serverState } from "./builders";
import { FakeHost, FakeShell } from "./fake-shell";
import { PROJECT, versionsFor } from "./shared-builders";

/**
 * A scripted server for editor-only tests. It keeps the server's copy of the drawing (doc, versions, seq)
 * and sends nothing until the test says so, so every pending path can be driven step by step.
 * It does not validate or check expectations: the tests decide the outcome (the real server is in @fm/sync-tests).
 */
export class FakeRemote {
  readonly shell: FakeShell;
  doc: Document;
  versions: VersionMap;
  seq = 0;
  private bobEdits = 0;

  private constructor(shell: FakeShell, doc: Document) {
    this.shell = shell;
    this.doc = doc;
    this.versions = versionsFor(doc, "c0");
  }

  /** A server-mode editor with `doc` open as project p1 "Apartment": connected, seq 0, every entity at version c0. */
  static open(doc: Document = emptyDocument()): FakeRemote {
    const host = new FakeHost();
    const remote = new FakeRemote(new FakeShell(serverState(host), host), doc);
    remote.event({ type: "connection", state: "open" });
    remote.shell.ui({ type: "openProject", id: PROJECT.id });
    remote.snapshot();
    return remote;
  }

  event(e: ServerEvent): void {
    this.shell.send({ type: "serverEvent", event: e });
  }

  /** The generation of the editor's latest open or resync request. */
  generation(): string {
    const opens = this.shell.effectsOf("workspace").flatMap((e) => (e.op.type === "open" ? [e.op.generation] : []));
    const last = opens[opens.length - 1];
    if (last === undefined) throw new Error("the editor has not asked to open the project");
    return last;
  }

  /** The server's full state for the latest generation. */
  snapshot(): void {
    this.event({
      type: "snapshot", projectId: PROJECT.id, generation: this.generation(), meta: PROJECT,
      doc: toStored(this.doc), versions: this.versions, seq: this.seq,
    });
  }

  submits(): Changeset[] {
    return this.shell.effectsOf("submit").map((e) => e.changeset);
  }

  last(): Changeset {
    const all = this.submits();
    const cs = all[all.length - 1];
    if (!cs) throw new Error("nothing was submitted");
    return cs;
  }

  /** Accept a submission: apply it, broadcast it back to its sender, then acknowledge it (spec §7.2). */
  accept(cs: Changeset = this.last()): void {
    this.apply(cs);
    this.event({ type: "changes", projectId: PROJECT.id, generation: this.generation(), seq: this.seq, changeset: cs, clientId: this.shell.state.me.clientId });
    this.event({ type: "ack", projectId: PROJECT.id, generation: this.generation(), changesetId: cs.id, seq: this.seq });
  }

  reject(cs: Changeset = this.last(), reason: RejectReason = { kind: "conflict", entities: [] }): void {
    this.event({ type: "rejected", projectId: PROJECT.id, generation: this.generation(), changesetId: cs.id, reason });
  }

  /** Bob's edit: executed on the server's copy, accepted and broadcast to the editor. */
  remote(cmd: Command): Changeset {
    const r = unwrap(execute(this.doc, cmd));
    this.bobEdits += 1;
    const keys = uniqueKeys([...patchWrites(r.patch), ...r.patch.dependencies]);
    const cs: Changeset = {
      id: `bob${this.bobEdits}`,
      patch: { puts: r.patch.puts, deletes: r.patch.deletes },
      expect: buildExpectations(this.versions, keys),
    };
    this.apply(cs);
    this.event({ type: "changes", projectId: PROJECT.id, generation: this.generation(), seq: this.seq, changeset: cs, clientId: "bob" });
    return cs;
  }

  disconnect(): void {
    this.event({ type: "connection", state: "closed" });
  }

  /** The connection returns: the editor reopens with a new generation and the server answers with a snapshot. */
  reconnect(): void {
    this.event({ type: "connection", state: "open" });
    this.snapshot();
  }

  private apply(cs: Changeset): void {
    this.doc = unwrap(applyPatch(this.doc, cs.patch));
    this.versions = stampVersions(this.versions, cs.patch, cs.id);
    this.seq += 1;
  }
}
