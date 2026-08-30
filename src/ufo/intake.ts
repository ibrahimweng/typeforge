/**
 * Getting a folder into a browser, and back out of it.
 *
 * This is the part of reading a UFO that has nothing to do with fonts. The
 * format is a directory, and a directory is the one thing a web page is not
 * really given: a file input hands over files, a download hands back one file,
 * and neither has any idea what a folder is.
 *
 * There are three ways in and a designer will reach for whichever is nearest,
 * so all three are here rather than whichever was easiest:
 *
 *   a folder picked      the input carries `webkitdirectory`, and every file
 *                        arrives with the path it had inside the folder
 *   a folder dropped     a drop gives entries rather than files, and a
 *                        directory entry has to be walked
 *   a zip                `.ufoz` is a zipped UFO and part of the format; a
 *                        folder somebody compressed to email is the same thing
 *
 * On the way out there is only one, because a page cannot hand back a folder:
 * it goes as a zip named for the font, which every operating system expands
 * into the folder it was.
 */

import { unzipSync, zipSync } from "fflate";

import type { UfoFiles } from "./font";

/**
 * The paths inside the UFO, whatever they were inside on the way here.
 *
 * A folder picked in a browser arrives as `MyFont.ufo/metainfo.plist`, and one
 * picked from a directory holding several as `Fonts/MyFont.ufo/metainfo.plist`.
 * Rather than counting segments, this finds the file the format requires and
 * takes wherever that is as the root -- which is right for both, and for a zip
 * that has the folder inside it and one that is the folder.
 */
function rootedAtMetainfo(files: UfoFiles): UfoFiles | null {
  let prefix: string | null = null;
  for (const path of files.keys()) {
    if (!path.endsWith("metainfo.plist")) continue;
    const at = path.slice(0, -"metainfo.plist".length);
    // The shallowest one, so a UFO with another UFO inside its data directory
    // opens as itself rather than as the one it carries.
    if (prefix === null || at.length < prefix.length) prefix = at;
  }
  if (prefix === null) return null;
  if (prefix === "") return files;

  const rooted: UfoFiles = new Map();
  for (const [path, value] of files) {
    if (!path.startsWith(prefix)) continue;
    rooted.set(path.slice(prefix.length), value);
  }
  return rooted;
}

/** Whether a name is one of the things an operating system leaves lying about. */
function isRubbish(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  // `.DS_Store` on a Mac, `Thumbs.db` on Windows, and the `__MACOSX` shadow a
  // Mac puts in a zip. None of them is part of the font and all of them turn
  // up in a folder somebody has looked at.
  return name === ".DS_Store" || name === "Thumbs.db" || path.startsWith("__MACOSX/");
}

/**
 * A folder picked through an input carrying `webkitdirectory`.
 *
 * Every file knows the path it had inside the folder, which is the only reason
 * this works at all: a plain multiple-file input would give the same files with
 * no idea which folder any of them was in.
 */
export async function filesFromPicker(list: FileList | File[]): Promise<UfoFiles | null> {
  const files: UfoFiles = new Map();
  for (const file of Array.from(list)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (isRubbish(path)) continue;
    files.set(path, new Uint8Array(await file.arrayBuffer()));
  }
  return rootedAtMetainfo(files);
}

/*
 * A dropped directory, walked.
 *
 * `readEntries` hands back at most a hundred entries at a time and says it is
 * finished by giving back none, so it has to be called until it does. A glyphs
 * folder is one file per glyph and a font of any size has more than a hundred
 * of them -- read once, every alphabet past the first hundred letters would
 * simply not be there, and the font would open looking plausible and wrong.
 */
async function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

async function walkEntry(entry: FileSystemEntry, at: string, into: UfoFiles): Promise<void> {
  const path = at ? `${at}/${entry.name}` : entry.name;
  if (isRubbish(path)) return;

  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (file) into.set(path, new Uint8Array(await file.arrayBuffer()));
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (const child of await readEntries(reader)) {
      await walkEntry(child, path, into);
    }
  }
}

/** A folder dropped on the window, or null if what was dropped is not one. */
export async function filesFromDrop(items: DataTransferItemList): Promise<UfoFiles | null> {
  const entries: FileSystemEntry[] = [];
  // Collected before anything is awaited: a `DataTransferItemList` is emptied
  // as soon as the drop handler returns, so reaching for it later finds
  // nothing. This is the single most common way a folder drop breaks.
  for (const item of Array.from(items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return null;

  const files: UfoFiles = new Map();
  for (const entry of entries) await walkEntry(entry, "", files);
  return rootedAtMetainfo(files);
}

/** A zipped UFO, which is what `.ufoz` is and what a compressed folder is. */
export function filesFromZip(bytes: Uint8Array): UfoFiles | null {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return null;
  }
  const files: UfoFiles = new Map();
  for (const [path, value] of Object.entries(entries)) {
    // A zip lists directories as entries with nothing in them.
    if (path.endsWith("/") || isRubbish(path)) continue;
    files.set(path, value);
  }
  return rootedAtMetainfo(files);
}

/** Whether some bytes are a zip, by the signature every zip opens with. */
export function looksZipped(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * A UFO, as a zip a browser can hand back.
 *
 * Deflated rather than stored, which is the opposite of what `font/zip.ts`
 * decided and for the opposite reason. That one packs fonts, which are
 * coordinates and barely compress; this packs XML, which is mostly the same
 * few tag names over and over and compresses to about a sixth. A font of six
 * thousand glyphs is six thousand small files, and the difference is a
 * download somebody waits for and one they do not.
 */
export function zipUfo(files: UfoFiles, folderName: string): Uint8Array {
  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  const stem = folderName.endsWith(".ufo") ? folderName : `${folderName}.ufo`;
  for (const [path, value] of files) {
    entries[`${stem}/${path}`] = typeof value === "string" ? encoder.encode(value) : value;
  }
  return zipSync(entries, { level: 6 });
}

/** A folder name that will survive a download folder. */
export function ufoNameFor(familyName: string, styleName: string): string {
  const family = familyName.trim().replace(/[^A-Za-z0-9]+/g, "") || "Untitled";
  const style = styleName.trim().replace(/[^A-Za-z0-9]+/g, "") || "Regular";
  return `${family}-${style}.ufo`;
}
