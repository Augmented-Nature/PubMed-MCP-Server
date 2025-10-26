/**
 * Type definitions for PubMed MCP Server
 */

export interface PubMedArticle {
  pmid: string;
  title: string;
  abstract?: string;
  authors: Author[];
  journal: string;
  publicationDate: string;
  doi?: string;
  pmcid?: string;
  articleIds: ArticleId[];
  meshTerms?: MeshTerm[];
  publicationTypes?: string[];
  keywords?: string[];
  affiliations?: string[];
  volume?: string;
  issue?: string;
  pages?: string;
  language?: string;
  grantList?: Grant[];
}

export interface Author {
  lastName: string;
  foreName?: string;
  initials?: string;
  affiliation?: string;
  collectiveName?: string;
}

export interface ArticleId {
  idType: string;
  value: string;
}

export interface MeshTerm {
  descriptorName: string;
  qualifierName?: string;
  majorTopic: boolean;
}

export interface Grant {
  grantId?: string;
  agency?: string;
  country?: string;
}

export interface SearchResult {
  count: number;
  retmax: number;
  retstart: number;
  pmids: string[];
  translationSet?: TranslationItem[];
  queryTranslation?: string;
}

export interface TranslationItem {
  from: string;
  to: string;
}

export interface CitationData {
  pmid: string;
  citedBy: string[];
  references: string[];
  citationCount: number;
}

export interface JournalInfo {
  title: string;
  isoAbbreviation?: string;
  issn?: string;
  issnType?: string;
  country?: string;
  nlmId?: string;
}

export interface AuthorPublication {
  author: string;
  publications: PubMedArticle[];
  totalCount: number;
}

export interface PublicationTrend {
  year: number;
  count: number;
  percentage?: number;
}

export interface EUtilsConfig {
  apiKey?: string;
  email?: string;
  tool?: string;
  baseUrl: string;
  rateLimit: number;
}

export interface SearchParams {
  term: string;
  retmax?: number;
  retstart?: number;
  sort?: string;
  mindate?: string;
  maxdate?: string;
  datetype?: string;
  field?: string;
}

export interface FetchParams {
  db: string;
  id: string | string[];
  retmode?: string;
  rettype?: string;
}

export interface LinkParams {
  dbfrom: string;
  db: string;
  id: string | string[];
  cmd?: string;
  linkname?: string;
}

export interface SummaryParams {
  db: string;
  id: string | string[];
  retmode?: string;
}

export interface CitationFormat {
  format: 'apa' | 'mla' | 'chicago' | 'bibtex' | 'ris' | 'endnote';
  citation: string;
}

export interface FullTextArticle {
  pmcid: string;
  pmid?: string;
  title: string;
  abstract?: string;
  body: string;
  authors: Author[];
  journal: string;
  publicationDate: string;
  doi?: string;
  sections?: ArticleSection[];
  figures?: Figure[];
  tables?: Table[];
  references?: Reference[];
}

export interface ArticleSection {
  title: string;
  content: string;
  subsections?: ArticleSection[];
}

export interface Figure {
  id: string;
  label: string;
  caption: string;
  url?: string;
}

export interface Table {
  id: string;
  label: string;
  caption: string;
  content: string;
}

export interface Reference {
  id: string;
  citation: string;
  pmid?: string;
  doi?: string;
}

export interface ValidationResult {
  valid: boolean;
  pmid?: string;
  exists?: boolean;
  message?: string;
}

export interface IdentifierConversion {
  inputId: string;
  inputType: string;
  conversions: {
    pmid?: string;
    doi?: string;
    pmcid?: string;
  };
}

export interface APIStatus {
  status: 'operational' | 'degraded' | 'down';
  rateLimit: {
    limit: number;
    remaining: number;
    reset: Date;
  };
  message?: string;
}
