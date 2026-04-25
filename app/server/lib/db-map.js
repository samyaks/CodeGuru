const crypto = require('crypto');

function db() {
  return require('./db');
}

function toNumConfidence(v) {
  if (v == null) return 0.8;
  const n = Number(v);
  if (Number.isNaN(n)) return 0.8;
  return n;
}

const productMap = {
  async createProductMapWithGraph({ map, personas, jobs, entities, edges, scores }) {
    const mapId = map.id || crypto.randomUUID();
    const { toJsonb, withTransaction } = db();
    await withTransaction(async (c) => {
      await c.query(
        `INSERT INTO product_maps (id, project_id, analysis_id, description, domain, scores, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, COALESCE($7::timestamptz, now()))`,
        [
          mapId,
          map.project_id,
          map.analysis_id || null,
          map.description,
          map.domain || null,
          toJsonb(scores || {}),
          map.created_at || null,
        ]
      );
      for (const p of personas) {
        await c.query(
          `INSERT INTO map_personas (id, map_id, name, description, emoji, confirmed, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            p.id,
            mapId,
            p.name,
            p.description ?? null,
            p.emoji || '👤',
            !!p.confirmed,
            p.sort_order ?? 0,
          ]
        );
      }
      for (const j of jobs) {
        await c.query(
          `INSERT INTO map_jobs (id, map_id, persona_id, title, priority, weight, confirmed, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            j.id,
            mapId,
            j.persona_id || j.personaId,
            j.title,
            j.priority || 'medium',
            j.weight != null ? j.weight : 2,
            !!j.confirmed,
            j.sort_order ?? 0,
          ]
        );
      }
      for (const e of entities) {
        await c.query(
          `INSERT INTO map_entities (id, map_id, type, key, label, file_path, status, module, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
          [
            e.id,
            mapId,
            e.type,
            e.key,
            e.label ?? null,
            e.file_path || e.filePath || null,
            e.status || 'detected',
            e.module ?? null,
            toJsonb(e.metadata || {}),
          ]
        );
      }
      for (const e of edges) {
        const id = e.id || crypto.randomUUID();
        await c.query(
          `INSERT INTO map_edges (id, map_id, from_id, to_id, type, label, confidence, method, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
          [
            id,
            mapId,
            e.fromId || e.from_id,
            e.toId || e.to_id,
            e.type,
            e.label ?? null,
            toNumConfidence(e.confidence),
            e.method || 'ai',
            e.created_at || null,
          ]
        );
      }
    });
    return mapId;
  },

  async getProductMap(mapId) {
    const getDb = db().getDb;
    const { rows: maps } = await getDb().query('SELECT * FROM product_maps WHERE id = $1', [mapId]);
    const m = maps[0];
    if (!m) return null;
    const [personas, jobs, entities, edges] = await Promise.all([
      getDb().query('SELECT * FROM map_personas WHERE map_id = $1 ORDER BY sort_order ASC, name ASC', [mapId]),
      getDb().query('SELECT * FROM map_jobs WHERE map_id = $1 ORDER BY sort_order ASC, title ASC', [mapId]),
      getDb().query('SELECT * FROM map_entities WHERE map_id = $1 ORDER BY type ASC, key ASC', [mapId]),
      getDb().query('SELECT * FROM map_edges WHERE map_id = $1 ORDER BY created_at ASC', [mapId]),
    ]);
    return {
      map: m,
      personas: personas.rows,
      jobs: jobs.rows,
      entities: entities.rows,
      edges: edges.rows,
    };
  },

  async getMapByProject(projectId) {
    const { rows } = await db().getDb().query(
      `SELECT id FROM product_maps WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    if (!rows[0]) return null;
    return this.getProductMap(rows[0].id);
  },

  async updateMapScores(mapId, scores) {
    const { toJsonb } = db();
    await db().getDb().query('UPDATE product_maps SET scores = $1::jsonb WHERE id = $2', [toJsonb(scores), mapId]);
  },

  async updatePersona(personaId, data) {
    const allowed = new Set(['name', 'description', 'emoji', 'confirmed', 'sort_order']);
    const fields = Object.keys(data).filter((k) => allowed.has(k) && data[k] !== undefined);
    if (fields.length === 0) return;
    const sets = [];
    const params = [];
    for (const k of fields) {
      params.push(data[k]);
      sets.push(`${k} = $${params.length}`);
    }
    params.push(personaId);
    await db().getDb().query(
      `UPDATE map_personas SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  },

  async addPersona(mapId, p) {
    const id = p.id || crypto.randomUUID();
    const { rows: ord } = await db().getDb().query(
      'SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM map_personas WHERE map_id = $1',
      [mapId]
    );
    const sort = p.sort_order != null ? p.sort_order : (ord[0].n || 0);
    await db().getDb().query(
      `INSERT INTO map_personas (id, map_id, name, description, emoji, confirmed, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, mapId, p.name, p.description ?? null, p.emoji || '👤', !!p.confirmed, sort]
    );
    return id;
  },

  async removePersona(personaId) {
    await db().getDb().query('DELETE FROM map_personas WHERE id = $1', [personaId]);
  },

  async updateJob(jobId, data) {
    const allowed = new Set(['title', 'priority', 'weight', 'confirmed', 'sort_order', 'persona_id']);
    const fields = Object.keys(data).filter((k) => allowed.has(k) && data[k] !== undefined);
    if (fields.length === 0) return;
    const sets = [];
    const params = [];
    for (const k of fields) {
      params.push(data[k]);
      sets.push(`${k} = $${params.length}`);
    }
    params.push(jobId);
    await db().getDb().query(
      `UPDATE map_jobs SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
  },

  async addJob(mapId, j) {
    const id = j.id || crypto.randomUUID();
    const { rows: ord } = await db().getDb().query(
      'SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM map_jobs WHERE map_id = $1',
      [mapId]
    );
    const sort = j.sort_order != null ? j.sort_order : (ord[0].n || 0);
    const w = j.weight != null
      ? j.weight
      : (j.priority === 'high' ? 3 : j.priority === 'low' ? 1 : 2);
    await db().getDb().query(
      `INSERT INTO map_jobs (id, map_id, persona_id, title, priority, weight, confirmed, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        mapId,
        j.personaId || j.persona_id,
        j.title,
        j.priority || 'medium',
        w,
        !!j.confirmed,
        sort,
      ]
    );
    return id;
  },

  async removeJob(jobId) {
    await db().getDb().query('DELETE FROM map_jobs WHERE id = $1', [jobId]);
  },

  async addEdge(mapId, edge) {
    const id = edge.id || crypto.randomUUID();
    await db().getDb().query(
      `INSERT INTO map_edges (id, map_id, from_id, to_id, type, label, confidence, method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        mapId,
        edge.fromId || edge.from_id,
        edge.toId || edge.to_id,
        edge.type,
        edge.label ?? null,
        toNumConfidence(edge.confidence),
        edge.method || 'user',
      ]
    );
    return id;
  },

  async removeEdge(edgeId) {
    await db().getDb().query('DELETE FROM map_edges WHERE id = $1', [edgeId]);
  },

  async confirmEdge(edgeId) {
    await db().getDb().query('UPDATE map_edges SET confidence = 1, method = $2 WHERE id = $1', [edgeId, 'user']);
  },

  /**
   * @returns {{ mapId: string, projectId: string } | null}
   */
  async getMapContext(mapId) {
    const { rows } = await db().getDb().query('SELECT id, project_id FROM product_maps WHERE id = $1', [mapId]);
    if (!rows[0]) return null;
    return { mapId: rows[0].id, projectId: rows[0].project_id };
  },
};

module.exports = { productMap, toNumConfidence };
