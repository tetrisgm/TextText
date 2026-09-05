"use client";

import { useState } from "react";
import { DocumentCollectionRenderer, DocumentEngineStyles } from "@/components/document/DocumentRenderer";
import type { DocumentSnapshot } from "@/lib/documents/model";
import type { CollectionQueryable } from "@/lib/documents/collection-query";
import {
  queryCollectionItems, collectionDateGroups, collectionBoardGroups,
  collectionCalendarMonth, collectionHeatmapDays,
} from "@/lib/presentation/collection-layout";
import { selectCollectionView } from "@/lib/presentation/collection-views";
import type { TemplateDefinition } from "@/lib/presentation/schema";
import styles from "./ItemTypeStudio.module.css";

export type CollectionPreviewMetadata = Pick<CollectionQueryable, "createdAt" | "updatedAt" | "publishedAt"> & { pinned?: boolean };
export type CollectionPreviewItem = CollectionQueryable & CollectionPreviewMetadata & { document: DocumentSnapshot };

export function collectionPreviewItem(document: DocumentSnapshot, metadata: CollectionPreviewMetadata = {}): CollectionPreviewItem {
  return { ...metadata, document, title: document.content.title, fields: document.content.fields };
}

function CalendarPreview({ groups }: { groups: NonNullable<ReturnType<typeof collectionDateGroups<CollectionPreviewItem>>> }) {
  const [offset, setOffset] = useState(0);
  // Start at the first matching date in query order, so a real or sample
  // collection from another month is visible immediately.
  const firstKey = groups.byDay.keys().next().value;
  const first = firstKey ? new Date(`${firstKey}T12:00:00`) : new Date();
  const anchor = new Date(first.getFullYear(), first.getMonth() + offset, 1);
  const { cells, monthLabel } = collectionCalendarMonth(anchor);
  return (
    <div className={styles.calendarPreview}>
      <header>
        <button type="button" className={styles.quietButton} onClick={() => setOffset((value) => value - 1)} aria-label="Previous preview month">‹</button>
        <strong>{monthLabel}</strong>
        <button type="button" className={styles.quietButton} onClick={() => setOffset((value) => value + 1)} aria-label="Next preview month">›</button>
      </header>
      <div className={styles.calendarWeekdays} aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className={styles.calendarGrid}>
        {cells.map((cell, index) => (
          <div key={cell.key ?? `blank-${index}`} data-date={cell.key ?? undefined}>
            {cell.day !== null ? <small>{cell.day}</small> : null}
            {(cell.key ? groups.byDay.get(cell.key) ?? [] : []).map((entry, itemIndex) => (
              <strong key={itemIndex}>{entry.title || "Untitled"}</strong>
            ))}
          </div>
        ))}
      </div>
      {groups.undated.length ? (
        <section className={styles.calendarUndated} aria-label="Undated preview items">
          <h3>Undated</h3>
          {groups.undated.map((entry, index) => <p key={index}>{entry.title || "Untitled"}</p>)}
        </section>
      ) : null}
    </div>
  );
}

export function ItemTypeCollectionPreview({ items, template, label }: {
  items: CollectionPreviewItem[];
  template: TemplateDefinition;
  label: string;
}) {
  const [viewId, setViewId] = useState(template.collection.defaultView ?? "");
  const activeId = template.collection.views.some((view) => view.id === viewId)
    ? viewId : template.collection.defaultView ?? "";
  const collection = selectCollectionView(template.collection, activeId);
  const sorted = queryCollectionItems(items, collection);
  const dated = collectionDateGroups(sorted, collection, template.fields);
  const board = collectionBoardGroups(sorted, collection, template.fields);
  const previewTemplate = { ...template, collection };
  const positions = new Map(sorted.map((entry, index) => [entry, index]));
  const card = (entry: CollectionPreviewItem, index: number) => (
    <DocumentCollectionRenderer key={index} document={entry.document} template={previewTemplate} documentId={`item-type-folder-${label}-${positions.get(entry)}`} />
  );
  return (
    <div className={styles.previewSurface} aria-label={label}>
      <DocumentEngineStyles />
      {collection.views.length ? (
        <label className={styles.collectionViewPicker}>
          <span>Preview saved view</span>
          <select aria-label="Preview saved view" value={activeId} onChange={(event) => setViewId(event.currentTarget.value)}>
            {!collection.defaultView ? <option value="">Base view</option> : null}
            {collection.views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
        </label>
      ) : null}
      <p className={styles.collectionPreviewNote}>Collection query preview. Layout spacing is approximate.</p>
      {sorted.length === 0 ? (
        <div className={styles.emptyPreview}>
          <span aria-hidden="true">□</span>
          <strong>{items.length ? "No matching items" : "No items yet"}</strong>
          <p>{items.length ? "No preview items match this view's filters." : "The folder stays quiet until its first item is added."}</p>
        </div>
      ) : collection.layout === "calendar" && dated ? (
        <CalendarPreview key={`${activeId}-${dated.byDay.keys().next().value ?? "empty"}`} groups={dated} />
      ) : board ? (
        <div className={styles.boardPreview}>
          {[...board.columns, ...(board.unsorted.length ? [{ value: "__unsorted", label: "Unsorted", tone: "neutral", items: board.unsorted }] : [])].map((column) => (
            <section key={column.value} className={styles.boardColumn}>
              <header className={`${styles.boardHeader} ${styles[`tone${column.tone[0].toUpperCase()}${column.tone.slice(1)}`] ?? ""}`}>
                <span aria-hidden="true" /><strong>{column.label}</strong><small>{column.items.length}</small>
              </header>
              {column.items.map(card)}
            </section>
          ))}
        </div>
      ) : (
        <>
          {collection.layout === "heatmap" && dated ? (
            <div className="universal-item-heatmap" aria-label="A year of preview activity">
              {collectionHeatmapDays(new Map([...dated.byDay].map(([day, entries]) => [day, entries.length])), new Date()).map((day) => (
                <span key={day.key} className={`universal-item-heatmap-cell is-l${Math.min(day.count, 3)}`} title={`${day.key} · ${day.count} entries`} />
              ))}
            </div>
          ) : null}
          <div className={styles.collectionPreview} data-layout={collection.layout} style={collection.layout === "cards" ? { gridTemplateColumns: `repeat(${collection.columns}, minmax(0, 1fr))` } : undefined}>
            {sorted.map(card)}
          </div>
        </>
      )}
    </div>
  );
}
