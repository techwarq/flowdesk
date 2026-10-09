
import fs from 'fs-extra';
import path from 'path';
import { DATA_DIR } from './config.js';

export interface VectorDocument {
    id: string;
    text: string;
    metadata: Record<string, any>;
    embedding: number[];
}

// Per-user vector store instances cache
const userStores: Map<string, LocalVectorStore> = new Map();

export class LocalVectorStore {
    private filePath: string;
    private userId: string;
    private documents: VectorDocument[] = [];
    private loaded = false;

    constructor(userId: string = 'default') {
        this.userId = userId;
        // Per-user vector file
        this.filePath = path.join(DATA_DIR, `vectors_${userId}.json`);
    }

    async load() {
        if (this.loaded) return;
        try {
            if (await fs.pathExists(this.filePath)) {
                this.documents = await fs.readJSON(this.filePath);
                console.log(`[VectorStore] Loaded ${this.documents.length} vectors for user ${this.userId}`);
            }
        } catch (e) {
            console.error('[VectorStore] Failed to load vectors', e);
            this.documents = [];
        }
        this.loaded = true;
    }

    async save() {
        try {
            await fs.writeJSON(this.filePath, this.documents);
            console.log(`[VectorStore] Saved ${this.documents.length} vectors for user ${this.userId}`);
        } catch (e) {
            console.error('[VectorStore] Failed to save vectors', e);
        }
    }

    async addDocuments(docs: VectorDocument[]) {
        await this.load();
        const newIds = new Set(docs.map(d => d.id));
        // Remove existing documents with same ID (upsert)
        this.documents = this.documents.filter(d => !newIds.has(d.id));
        this.documents.push(...docs);
        await this.save();
    }

    async search(queryEmbedding: number[], k: number = 5): Promise<VectorDocument[]> {
        await this.load();
        if (this.documents.length === 0) return [];

        const scores = this.documents.map(doc => {
            return {
                doc,
                score: cosineSimilarity(queryEmbedding, doc.embedding)
            };
        });

        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, k).map(s => s.doc);
    }

    async clear() {
        this.documents = [];
        await this.save();
    }

    async getDocumentCount(): Promise<number> {
        await this.load();
        return this.documents.length;
    }

    hasDocument(id: string): boolean {
        return this.documents.some(d => d.id === id);
    }

    getAllDocuments(): VectorDocument[] {
        return [...this.documents];
    }
}

// Get or create a vector store for a user
export function getVectorStoreForUser(userId: string): LocalVectorStore {
    if (!userStores.has(userId)) {
        userStores.set(userId, new LocalVectorStore(userId));
    }
    return userStores.get(userId)!;
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
