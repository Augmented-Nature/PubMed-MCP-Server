#!/usr/bin/env node

/**
 * PubMed MCP Server
 * Provides access to PubMed biomedical literature database through Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';
import { EUtilsClient } from './api/eutils.js';
import { PMCClient } from './api/pmc.js';
import {
  isValidPMID,
  isValidDOI,
  isValidPMCID,
  normalizePMCID,
  formatCitation,
  buildFieldQuery,
  combineSearchTerms,
  chunkArray,
  extractErrorMessage,
  formatDateForAPI
} from './api/utils.js';

// Initialize API clients
const apiKey = process.env.NCBI_API_KEY;
const email = process.env.NCBI_EMAIL;

const eutilsClient = new EUtilsClient(apiKey, email);
const pmcClient = new PMCClient(apiKey);

// Create MCP server
const server = new Server(
  {
    name: 'pubmed-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Search & Discovery Tools
      {
        name: 'search_articles',
        description: 'Search PubMed for articles by keywords, authors, journals, dates, or MeSH terms. Returns PMIDs and basic metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (e.g., "cancer treatment", "Smith J[Author]", "Nature[Journal]")'
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (1-1000, default: 20)',
              minimum: 1,
              maximum: 1000
            },
            start: {
              type: 'number',
              description: 'Starting position for pagination (default: 0)',
              minimum: 0
            },
            sort: {
              type: 'string',
              description: 'Sort order',
              enum: ['relevance', 'pub_date', 'author', 'journal']
            },
            date_from: {
              type: 'string',
              description: 'Start date for date range (YYYY/MM/DD format)'
            },
            date_to: {
              type: 'string',
              description: 'End date for date range (YYYY/MM/DD format)'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'advanced_search',
        description: 'Perform advanced search with field-specific queries and boolean operators',
        inputSchema: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Search in article titles'
            },
            abstract: {
              type: 'string',
              description: 'Search in abstracts'
            },
            author: {
              type: 'string',
              description: 'Author name'
            },
            journal: {
              type: 'string',
              description: 'Journal name'
            },
            mesh_terms: {
              type: 'array',
              items: { type: 'string' },
              description: 'MeSH (Medical Subject Headings) terms'
            },
            publication_types: {
              type: 'array',
              items: { type: 'string' },
              description: 'Publication types (e.g., "Clinical Trial", "Review")'
            },
            boolean_operator: {
              type: 'string',
              enum: ['AND', 'OR'],
              description: 'Boolean operator to combine terms (default: AND)'
            },
            max_results: {
              type: 'number',
              description: 'Maximum results (default: 20)',
              minimum: 1,
              maximum: 1000
            }
          }
        }
      },
      {
        name: 'search_by_author',
        description: 'Find articles by specific author(s)',
        inputSchema: {
          type: 'object',
          properties: {
            author_name: {
              type: 'string',
              description: 'Author name (e.g., "Smith J", "John Smith")'
            },
            affiliation: {
              type: 'string',
              description: 'Author affiliation/institution (optional)'
            },
            max_results: {
              type: 'number',
              description: 'Maximum results (default: 50)',
              minimum: 1,
              maximum: 1000
            }
          },
          required: ['author_name']
        }
      },
      {
        name: 'search_by_journal',
        description: 'Search articles within specific journal(s)',
        inputSchema: {
          type: 'object',
          properties: {
            journal_name: {
              type: 'string',
              description: 'Journal name or abbreviation'
            },
            keywords: {
              type: 'string',
              description: 'Additional keywords to search within the journal'
            },
            date_from: {
              type: 'string',
              description: 'Start date (YYYY/MM/DD)'
            },
            date_to: {
              type: 'string',
              description: 'End date (YYYY/MM/DD)'
            },
            max_results: {
              type: 'number',
              description: 'Maximum results (default: 50)',
              minimum: 1,
              maximum: 1000
            }
          },
          required: ['journal_name']
        }
      },
      {
        name: 'search_by_mesh_terms',
        description: 'Search using Medical Subject Headings (MeSH) terms',
        inputSchema: {
          type: 'object',
          properties: {
            mesh_terms: {
              type: 'array',
              items: { type: 'string' },
              description: 'MeSH terms to search for'
            },
            major_topic_only: {
              type: 'boolean',
              description: 'Only return articles where MeSH term is a major topic (default: false)'
            },
            max_results: {
              type: 'number',
              description: 'Maximum results (default: 50)',
              minimum: 1,
              maximum: 1000
            }
          },
          required: ['mesh_terms']
        }
      },
      {
        name: 'get_trending_articles',
        description: 'Get recently published or trending articles in a specific field',
        inputSchema: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description: 'Research field or topic'
            },
            days: {
              type: 'number',
              description: 'Number of days to look back (default: 30)',
              minimum: 1,
              maximum: 365
            },
            max_results: {
              type: 'number',
              description: 'Maximum results (default: 20)',
              minimum: 1,
              maximum: 100
            }
          },
          required: ['field']
        }
      },

      // Article Retrieval Tools
      {
        name: 'get_article_details',
        description: 'Get comprehensive metadata and abstract for a specific article by PMID',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID (e.g., "12345678")'
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'get_abstract',
        description: 'Retrieve article abstract by PMID',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID'
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'get_full_text',
        description: 'Retrieve full text from PubMed Central (PMC) when available',
        inputSchema: {
          type: 'object',
          properties: {
            pmcid: {
              type: 'string',
              description: 'PMC ID (e.g., "PMC1234567" or "1234567")'
            }
          },
          required: ['pmcid']
        }
      },
      {
        name: 'batch_article_lookup',
        description: 'Retrieve multiple articles efficiently (up to 200 PMIDs)',
        inputSchema: {
          type: 'object',
          properties: {
            pmids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of PubMed IDs',
              maxItems: 200
            }
          },
          required: ['pmids']
        }
      },

      // Citation & Reference Tools
      {
        name: 'get_cited_by',
        description: 'Find articles that cite a specific PMID',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID'
            },
            max_results: {
              type: 'number',
              description: 'Maximum citing articles to return (default: 100)',
              minimum: 1,
              maximum: 1000
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'get_references',
        description: 'Get reference list for an article',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID'
            },
            max_results: {
              type: 'number',
              description: 'Maximum references to return (default: 100)',
              minimum: 1,
              maximum: 1000
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'get_similar_articles',
        description: 'Find related articles based on content similarity',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID'
            },
            max_results: {
              type: 'number',
              description: 'Maximum similar articles (default: 20)',
              minimum: 1,
              maximum: 100
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'export_citation',
        description: 'Export citation in various formats (APA, MLA, Chicago, BibTeX, RIS)',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID'
            },
            format: {
              type: 'string',
              enum: ['apa', 'mla', 'chicago', 'bibtex', 'ris'],
              description: 'Citation format (default: apa)'
            }
          },
          required: ['pmid']
        }
      },

      // Validation & Utility Tools
      {
        name: 'validate_pmid',
        description: 'Validate PubMed ID format and check if article exists',
        inputSchema: {
          type: 'object',
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID to validate'
            }
          },
          required: ['pmid']
        }
      },
      {
        name: 'convert_identifiers',
        description: 'Convert between PMID, DOI, and PMC ID',
        inputSchema: {
          type: 'object',
          properties: {
            identifier: {
              type: 'string',
              description: 'Identifier to convert (PMID, DOI, or PMC ID)'
            },
            identifier_type: {
              type: 'string',
              enum: ['pmid', 'doi', 'pmcid', 'auto'],
              description: 'Type of input identifier (default: auto-detect)'
            }
          },
          required: ['identifier']
        }
      }
    ]
  };
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'search_articles':
        return await handleSearchArticles(args);

      case 'advanced_search':
        return await handleAdvancedSearch(args);

      case 'search_by_author':
        return await handleSearchByAuthor(args);

      case 'search_by_journal':
        return await handleSearchByJournal(args);

      case 'search_by_mesh_terms':
        return await handleSearchByMeshTerms(args);

      case 'get_trending_articles':
        return await handleGetTrendingArticles(args);

      case 'get_article_details':
        return await handleGetArticleDetails(args);

      case 'get_abstract':
        return await handleGetAbstract(args);

      case 'get_full_text':
        return await handleGetFullText(args);

      case 'batch_article_lookup':
        return await handleBatchArticleLookup(args);

      case 'get_cited_by':
        return await handleGetCitedBy(args);

      case 'get_references':
        return await handleGetReferences(args);

      case 'get_similar_articles':
        return await handleGetSimilarArticles(args);

      case 'export_citation':
        return await handleExportCitation(args);

      case 'validate_pmid':
        return await handleValidatePMID(args);

      case 'convert_identifiers':
        return await handleConvertIdentifiers(args);

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${errorMessage}`
    );
  }
});

// Tool handler implementations
async function handleSearchArticles(args: any) {
  const {
    query,
    max_results = 20,
    start = 0,
    sort,
    date_from,
    date_to
  } = args;

  const searchResult = await eutilsClient.search({
    term: query,
    retmax: max_results,
    retstart: start,
    sort: sort === 'pub_date' ? 'pub+date' : sort,
    mindate: date_from,
    maxdate: date_to
  });

  // Get article summaries for the PMIDs
  let articles: any[] = [];
  if (searchResult.pmids.length > 0) {
    const summaries = await eutilsClient.summary({
      db: 'pubmed',
      id: searchResult.pmids.slice(0, 20) // Limit to first 20 for summaries
    });

    if (summaries.result) {
      articles = searchResult.pmids.slice(0, 20).map((pmid: string) => {
        const summary = summaries.result[pmid];
        return {
          pmid,
          title: summary?.title || '',
          authors: summary?.authors?.map((a: any) => a.name).join(', ') || '',
          journal: summary?.source || '',
          publicationDate: summary?.pubdate || '',
          doi: summary?.elocationid || ''
        };
      });
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          totalResults: searchResult.count,
          returnedResults: searchResult.pmids.length,
          start: searchResult.retstart,
          pmids: searchResult.pmids,
          articles,
          queryTranslation: searchResult.queryTranslation
        }, null, 2)
      }
    ]
  };
}

async function handleAdvancedSearch(args: any) {
  const {
    title,
    abstract,
    author,
    journal,
    mesh_terms,
    publication_types,
    boolean_operator = 'AND',
    max_results = 20
  } = args;

  const queryParts: string[] = [];

  if (title) queryParts.push(buildFieldQuery(title, 'Title'));
  if (abstract) queryParts.push(buildFieldQuery(abstract, 'Abstract'));
  if (author) queryParts.push(buildFieldQuery(author, 'Author'));
  if (journal) queryParts.push(buildFieldQuery(journal, 'Journal'));

  if (mesh_terms && mesh_terms.length > 0) {
    const meshQuery = mesh_terms.map((term: string) => buildFieldQuery(term, 'MeSH Terms')).join(' OR ');
    queryParts.push(`(${meshQuery})`);
  }

  if (publication_types && publication_types.length > 0) {
    const ptQuery = publication_types.map((pt: string) => buildFieldQuery(pt, 'Publication Type')).join(' OR ');
    queryParts.push(`(${ptQuery})`);
  }

  if (queryParts.length === 0) {
    throw new Error('At least one search field must be provided');
  }

  const finalQuery = combineSearchTerms(queryParts, boolean_operator as 'AND' | 'OR');

  const searchResult = await eutilsClient.search({
    term: finalQuery,
    retmax: max_results
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          query: finalQuery,
          totalResults: searchResult.count,
          pmids: searchResult.pmids
        }, null, 2)
      }
    ]
  };
}

async function handleSearchByAuthor(args: any) {
  const { author_name, affiliation, max_results = 50 } = args;

  let query = buildFieldQuery(author_name, 'Author');

  if (affiliation) {
    query += ' AND ' + buildFieldQuery(affiliation, 'Affiliation');
  }

  const searchResult = await eutilsClient.search({
    term: query,
    retmax: max_results,
    sort: 'pub+date'
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          author: author_name,
          affiliation,
          totalResults: searchResult.count,
          pmids: searchResult.pmids
        }, null, 2)
      }
    ]
  };
}

async function handleSearchByJournal(args: any) {
  const { journal_name, keywords, date_from, date_to, max_results = 50 } = args;

  let query = buildFieldQuery(journal_name, 'Journal');

  if (keywords) {
    query += ' AND ' + keywords;
  }

  const searchResult = await eutilsClient.search({
    term: query,
    retmax: max_results,
    mindate: date_from,
    maxdate: date_to,
    sort: 'pub+date'
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          journal: journal_name,
          keywords,
          dateRange: { from: date_from, to: date_to },
          totalResults: searchResult.count,
          pmids: searchResult.pmids
        }, null, 2)
      }
    ]
  };
}

async function handleSearchByMeshTerms(args: any) {
  const { mesh_terms, major_topic_only = false, max_results = 50 } = args;

  const meshQueries = mesh_terms.map((term: string) => {
    const field = major_topic_only ? 'MeSH Major Topic' : 'MeSH Terms';
    return buildFieldQuery(term, field);
  });

  const query = combineSearchTerms(meshQueries, 'AND');

  const searchResult = await eutilsClient.search({
    term: query,
    retmax: max_results
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          meshTerms: mesh_terms,
          majorTopicOnly: major_topic_only,
          totalResults: searchResult.count,
          pmids: searchResult.pmids
        }, null, 2)
      }
    ]
  };
}

async function handleGetTrendingArticles(args: any) {
  const { field, days = 30, max_results = 20 } = args;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const searchResult = await eutilsClient.search({
    term: field,
    retmax: max_results,
    mindate: formatDateForAPI(startDate),
    maxdate: formatDateForAPI(endDate),
    sort: 'pub+date'
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          field,
          days,
          dateRange: {
            from: formatDateForAPI(startDate),
            to: formatDateForAPI(endDate)
          },
          totalResults: searchResult.count,
          pmids: searchResult.pmids
        }, null, 2)
      }
    ]
  };
}

async function handleGetArticleDetails(args: any) {
  const { pmid } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const article = await eutilsClient.getArticleDetails(pmid);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(article, null, 2)
      }
    ]
  };
}

async function handleGetAbstract(args: any) {
  const { pmid } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const article = await eutilsClient.getArticleDetails(pmid);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          pmid: article.pmid,
          title: article.title,
          abstract: article.abstract || 'No abstract available',
          authors: article.authors,
          journal: article.journal,
          publicationDate: article.publicationDate
        }, null, 2)
      }
    ]
  };
}

async function handleGetFullText(args: any) {
  const { pmcid } = args;

  if (!isValidPMCID(pmcid)) {
    throw new Error(`Invalid PMC ID format: ${pmcid}`);
  }

  const fullText = await pmcClient.getFullText(pmcid);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(fullText, null, 2)
      }
    ]
  };
}

async function handleBatchArticleLookup(args: any) {
  const { pmids } = args;

  if (!Array.isArray(pmids) || pmids.length === 0) {
    throw new Error('pmids must be a non-empty array');
  }

  if (pmids.length > 200) {
    throw new Error('Maximum 200 PMIDs allowed per batch');
  }

  // Validate all PMIDs
  for (const pmid of pmids) {
    if (!isValidPMID(pmid)) {
      throw new Error(`Invalid PMID format: ${pmid}`);
    }
  }

  // Process in chunks of 50
  const chunks = chunkArray(pmids, 50);
  const allArticles = [];

  for (const chunk of chunks) {
    const articles = await eutilsClient.getArticlesBatch(chunk);
    allArticles.push(...articles);
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          totalRequested: pmids.length,
          totalRetrieved: allArticles.length,
          articles: allArticles
        }, null, 2)
      }
    ]
  };
}

async function handleGetCitedBy(args: any) {
  const { pmid, max_results = 100 } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const citedByPmids = await eutilsClient.getCitedBy(pmid);
  const limitedPmids = citedByPmids.slice(0, max_results);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          pmid,
          citationCount: citedByPmids.length,
          citedBy: limitedPmids
        }, null, 2)
      }
    ]
  };
}

async function handleGetReferences(args: any) {
  const { pmid, max_results = 100 } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const referencePmids = await eutilsClient.getReferences(pmid);
  const limitedPmids = referencePmids.slice(0, max_results);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          pmid,
          referenceCount: referencePmids.length,
          references: limitedPmids
        }, null, 2)
      }
    ]
  };
}

async function handleGetSimilarArticles(args: any) {
  const { pmid, max_results = 20 } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const similarPmids = await eutilsClient.getSimilarArticles(pmid, max_results);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          pmid,
          similarArticles: similarPmids
        }, null, 2)
      }
    ]
  };
}

async function handleExportCitation(args: any) {
  const { pmid, format = 'apa' } = args;

  if (!isValidPMID(pmid)) {
    throw new Error(`Invalid PMID format: ${pmid}`);
  }

  const article = await eutilsClient.getArticleDetails(pmid);
  const citation = formatCitation(article, format as any);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          pmid,
          format,
          citation
        }, null, 2)
      }
    ]
  };
}

async function handleValidatePMID(args: any) {
  const { pmid } = args;

  const valid = isValidPMID(pmid);

  if (!valid) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            valid: false,
            pmid,
            message: 'Invalid PMID format. PMID must contain only digits.'
          }, null, 2)
        }
      ]
    };
  }

  // Check if article exists
  try {
    await eutilsClient.getArticleDetails(pmid);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            valid: true,
            pmid,
            exists: true,
            message: 'Valid PMID and article exists'
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            valid: true,
            pmid,
            exists: false,
            message: 'Valid PMID format but article not found'
          }, null, 2)
        }
      ]
    };
  }
}

async function handleConvertIdentifiers(args: any) {
  const { identifier, identifier_type = 'auto' } = args;

  let inputType = identifier_type;

  // Auto-detect identifier type
  if (inputType === 'auto') {
    if (isValidPMID(identifier)) {
      inputType = 'pmid';
    } else if (isValidDOI(identifier)) {
      inputType = 'doi';
    } else if (isValidPMCID(identifier)) {
      inputType = 'pmcid';
    } else {
      throw new Error('Unable to auto-detect identifier type');
    }
  }

  const conversions: any = {};

  try {
    if (inputType === 'pmid') {
      const article = await eutilsClient.getArticleDetails(identifier);
      conversions.pmid = article.pmid;
      conversions.doi = article.doi;
      conversions.pmcid = article.pmcid;
    } else if (inputType === 'doi') {
      const searchResult = await eutilsClient.search({
        term: `${identifier}[DOI]`,
        retmax: 1
      });

      if (searchResult.pmids.length > 0) {
        const article = await eutilsClient.getArticleDetails(searchResult.pmids[0]);
        conversions.pmid = article.pmid;
        conversions.doi = article.doi;
        conversions.pmcid = article.pmcid;
      }
    } else if (inputType === 'pmcid') {
      const normalizedId = normalizePMCID(identifier);
      const searchResult = await eutilsClient.search({
        term: `${normalizedId}[PMC ID]`,
        retmax: 1
      });

      if (searchResult.pmids.length > 0) {
        const article = await eutilsClient.getArticleDetails(searchResult.pmids[0]);
        conversions.pmid = article.pmid;
        conversions.doi = article.doi;
        conversions.pmcid = article.pmcid;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            inputId: identifier,
            inputType,
            conversions
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            inputId: identifier,
            inputType,
            conversions: {},
            error: extractErrorMessage(error)
          }, null, 2)
        }
      ]
    };
  }
}

/**
 * List available resources
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'pubmed://article/{pmid}',
        name: 'PubMed Article',
        description: 'Article metadata and abstract for a specific PMID',
        mimeType: 'application/json'
      },
      {
        uri: 'pubmed://fulltext/{pmcid}',
        name: 'PMC Full Text',
        description: 'Full text article from PubMed Central',
        mimeType: 'application/json'
      },
      {
        uri: 'pubmed://search/{query}',
        name: 'PubMed Search',
        description: 'Search results for a query',
        mimeType: 'application/json'
      }
    ]
  };
});

/**
 * Handle resource reads
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  try {
    if (uri.startsWith('pubmed://article/')) {
      const pmid = uri.replace('pubmed://article/', '');
      const article = await eutilsClient.getArticleDetails(pmid);

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(article, null, 2)
          }
        ]
      };
    }

    if (uri.startsWith('pubmed://fulltext/')) {
      const pmcid = uri.replace('pubmed://fulltext/', '');
      const fullText = await pmcClient.getFullText(pmcid);

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(fullText, null, 2)
          }
        ]
      };
    }

    if (uri.startsWith('pubmed://search/')) {
      const query = decodeURIComponent(uri.replace('pubmed://search/', ''));
      const searchResult = await eutilsClient.search({
        term: query,
        retmax: 20
      });

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(searchResult, null, 2)
          }
        ]
      };
    }

    throw new McpError(
      ErrorCode.InvalidRequest,
      `Unknown resource URI: ${uri}`
    );
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to read resource: ${errorMessage}`
    );
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('PubMed MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
