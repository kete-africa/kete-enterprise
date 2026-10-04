// The library's only door (spec 028): its tables, its routes, the assistant's tool.
export {
  knowledgeEmbedder as knowledgeEmbedderFor,
  useEmbedder,
} from './infrastructure/embedder.js';
export {
  addReaderKeys,
  knowledgeRoutes,
  knowledgeTablesSql,
  knowledgeTool,
  libraryOpen,
  readerKeys,
  unitKeys,
  type ReaderKeyProvider,
} from './knowledge.js';
