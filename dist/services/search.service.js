// backend/services/search.service.ts
import { generateEmbedding } from "../utils/mistral.js";
import { semanticSearch, keywordSearch, getDocumentById, } from "./vector.service.js";
import { AppError } from "../middleware/errorHandler.js";
// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_RESULTS = 5;
// Weights for hybrid scoring
// Semantic search is weighted higher as it captures meaning better
const SEMANTIC_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;
// ─── Normalize Keyword Results ────────────────────────────────────────────────
// Keyword results have no score — assign a fixed relevance score
function normalizeKeywordResults(results) {
    const scoreMap = new Map();
    results.forEach((result, index) => {
        // Rank-based scoring: first result gets highest score
        const score = 1 - index / (results.length || 1);
        scoreMap.set(result.id, score);
    });
    return scoreMap;
}
// ─── Merge and Re-rank Results ────────────────────────────────────────────────
// Combines semantic + keyword scores using weighted fusion
function mergeResults(semanticResults, keywordResults) {
    const mergedMap = new Map();
    // ── Add semantic results ──────────────────────────────────────────────────
    for (const result of semanticResults) {
        const weightedScore = result.similarity * SEMANTIC_WEIGHT;
        mergedMap.set(result.id, {
            chunk: result,
            score: weightedScore,
        });
    }
    // ── Add/merge keyword results ─────────────────────────────────────────────
    const keywordScores = normalizeKeywordResults(keywordResults);
    for (const result of keywordResults) {
        const keywordScore = (keywordScores.get(result.id) ?? 0) * KEYWORD_WEIGHT;
        if (mergedMap.has(result.id)) {
            // Chunk found in both — combine scores (hybrid boost)
            const existing = mergedMap.get(result.id);
            mergedMap.set(result.id, {
                chunk: existing.chunk,
                score: existing.score + keywordScore,
            });
        }
        else {
            // Keyword-only result
            mergedMap.set(result.id, {
                chunk: result,
                score: keywordScore,
            });
        }
    }
    return mergedMap;
}
// ─── Determine Search Type Label ──────────────────────────────────────────────
function getSearchType(id, semanticIds, keywordIds) {
    const inSemantic = semanticIds.has(id);
    const inKeyword = keywordIds.has(id);
    if (inSemantic && inKeyword)
        return "hybrid";
    if (inSemantic)
        return "semantic";
    return "keyword";
}
// ─── Enrich Results with Document Names ──────────────────────────────────────
// Fetch document names for all unique document IDs in results
async function enrichWithDocumentNames(documentIds) {
    const nameMap = new Map();
    const uniqueIds = [...new Set(documentIds)];
    await Promise.all(uniqueIds.map(async (id) => {
        try {
            const doc = await getDocumentById(id);
            nameMap.set(id, doc.name);
        }
        catch {
            nameMap.set(id, "Unknown Document");
        }
    }));
    return nameMap;
}
// ─── Main: Hybrid Search ──────────────────────────────────────────────────────
export async function hybridSearch(query) {
    if (!query || query.trim().length === 0) {
        throw new AppError("Search query cannot be empty.", 400, "EMPTY_QUERY");
    }
    console.log(`[Search] Running hybrid search for: "${query}"`);
    // ── Run both searches in parallel ────────────────────────────────────────
    const queryEmbedding = await generateEmbedding(query);
    const [semanticResults, keywordResults] = await Promise.all([
        semanticSearch(queryEmbedding, MAX_RESULTS),
        keywordSearch(query, MAX_RESULTS),
    ]);
    console.log(`[Search] Semantic: ${semanticResults.length} results, ` +
        `Keyword: ${keywordResults.length} results`);
    // ── Handle no results ─────────────────────────────────────────────────────
    if (semanticResults.length === 0 && keywordResults.length === 0) {
        console.log("[Search] No results found for query");
        return [];
    }
    // ── Merge and re-rank ─────────────────────────────────────────────────────
    const mergedMap = mergeResults(semanticResults, keywordResults);
    const semanticIds = new Set(semanticResults.map((r) => r.id));
    const keywordIds = new Set(keywordResults.map((r) => r.id));
    // ── Enrich with document names ────────────────────────────────────────────
    const allDocumentIds = [...mergedMap.values()].map(({ chunk }) => chunk.document_id);
    const documentNames = await enrichWithDocumentNames(allDocumentIds);
    // ── Build final sorted results ────────────────────────────────────────────
    const results = [...mergedMap.entries()]
        .map(([id, { chunk, score }]) => {
        const c = chunk;
        return {
            chunkId: id,
            documentId: c.document_id,
            documentName: documentNames.get(c.document_id) ?? "Unknown Document",
            content: c.content,
            pageNumber: c.page_number ?? null,
            chunkIndex: c.chunk_index,
            score: Math.min(score, 1), // Cap at 1.0
            searchType: getSearchType(id, semanticIds, keywordIds),
        };
    })
        .sort((a, b) => b.score - a.score) // Highest score first
        .slice(0, MAX_RESULTS);
    console.log(`[Search] ✅ Returning ${results.length} merged results ` +
        `(hybrid: ${results.filter((r) => r.searchType === "hybrid").length}, ` +
        `semantic: ${results.filter((r) => r.searchType === "semantic").length}, ` +
        `keyword: ${results.filter((r) => r.searchType === "keyword").length})`);
    return results;
}
