import fs from "fs";
import path from "path";

export interface StoredItem {
  access_token: string;
  item_id: string;
  institution_name: string;
  linked_at: string;
}

const ITEMS_FILE = path.join(__dirname, "..", "items.json");

function readItemsFile(): StoredItem[] {
  if (!fs.existsSync(ITEMS_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(ITEMS_FILE, "utf-8").trim();
  if (!raw) return [];
  return JSON.parse(raw) as StoredItem[];
}

function writeItemsFile(items: StoredItem[]): void {
  fs.writeFileSync(ITEMS_FILE, JSON.stringify(items, null, 2), "utf-8");
}

export function getItems(): StoredItem[] {
  return readItemsFile();
}

export function upsertItem(item: StoredItem): void {
  const items = readItemsFile();
  const idx = items.findIndex((i) => i.institution_name === item.institution_name);
  if (idx >= 0) {
    items[idx] = item;
  } else {
    items.push(item);
  }
  writeItemsFile(items);
}
