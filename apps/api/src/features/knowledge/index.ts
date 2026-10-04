// The library's only door (spec 028): its tables, its routes, the assistant's tool.
export { useEmbedder } from './infrastructure/embedder.js';
export {
  knowledgeRoutes,
  knowledgeTablesSql,
  knowledgeTool,
  libraryOpen,
  readerKeys,
  unitKeys,
} from './knowledge.js';
