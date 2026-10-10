import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getQueryCount, openDatabase, resetQueryCount } from "../src/db.ts";
import { listCreators } from "../src/list-creators.ts";
import { CAMPAIGN_ID, seed } from "../src/seed.ts";
import { listCreatorsReference } from "./reference-list-creators.ts";

const PAGES = [
  { limit: 20, offset: 0 },
  { limit: 20, offset: 20 },
  { limit: 50, offset: 37 },
  { limit: 1, offset: 0 },
  { limit: 20, offset: 100_000 },
];

async function expectSameAsReference(db: DatabaseSync, campaignId: string) {
  for (const page of PAGES) {
    const input = { campaignId, ...page };
    expect(await listCreators(db, input)).toEqual(await listCreatorsReference(db, input));
  }
}

// Poucos valores possíveis para forçar empate de score, de alcance e de captured_at.
function seedWithTies(db: DatabaseSync, creators: number) {
  let state = 42;
  const rand = (n: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return Math.floor((state / 4294967296) * n);
  };
  const niches = ["beleza", "moda", "tech", "games"];
  db.exec("BEGIN");
  db.prepare("INSERT INTO campaigns VALUES (?, ?, ?)").run("cmp_ties", "Empates", '["beleza","moda","beleza"]');
  const creator = db.prepare("INSERT INTO creators VALUES (?, ?, ?, '')");
  const account = db.prepare("INSERT INTO social_accounts VALUES (?, ?, 'instagram')");
  const metric = db.prepare("INSERT INTO metrics VALUES (?, ?, ?, ?, '')");
  const delivery = db.prepare("INSERT INTO deliveries VALUES (?, ?, ?)");
  for (let i = 0; i < creators; i += 1) {
    const id = `crt_${i}`;
    const own = Array.from({ length: rand(4) }, () => niches[rand(niches.length)]);
    creator.run(id, `Criador ${i}`, JSON.stringify(own));
    for (let a = 0; a < rand(3); a += 1) {
      const accountId = `acc_${i}_${a}`;
      account.run(accountId, id);
      for (let m = 0; m < rand(4); m += 1) {
        metric.run(`met_${i}_${a}_${rand(5)}_${m}`, accountId, rand(3) * 100, `2026-05-${10 + rand(2)}T00:00:00.000Z`);
      }
    }
    for (let d = 0; d < rand(4); d += 1) {
      delivery.run(`del_${i}_${d}`, id, rand(2) ? "2026-03-03T12:00:00.000Z" : "2026-03-03T11:59:59.999Z");
    }
  }
  db.exec("COMMIT");
}

describe("equivalência com a listagem original", () => {
  it.each([80, 600, 2000])("seed com %i criadores", async (creators) => {
    const db = openDatabase(":memory:");
    seed(db, { creators, seed: 7 });
    await expectSameAsReference(db, CAMPAIGN_ID);
  });

  it("empates de score, de alcance e de métrica mais recente", async () => {
    const db = openDatabase(":memory:");
    seedWithTies(db, 1500);
    await expectSameAsReference(db, "cmp_ties");
  });

  it("mantém o teto de queries com 5000 criadores e na página além do fim", async () => {
    const db = openDatabase(":memory:");
    seed(db, { creators: 5000, seed: 7 });
    for (const offset of [0, 100_000]) {
      resetQueryCount();
      await listCreators(db, { campaignId: CAMPAIGN_ID, limit: 20, offset });
      expect(getQueryCount()).toBeLessThanOrEqual(8);
    }
  });
});
