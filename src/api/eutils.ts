/**
 * E-utilities API client for PubMed
 * Documentation: https://www.ncbi.nlm.nih.gov/books/NBK25501/
 */

import axios, { AxiosInstance } from 'axios';
import {
  SearchParams,
  FetchParams,
  LinkParams,
  SummaryParams,
  SearchResult,
  PubMedArticle,
  Author,
  MeshTerm,
  ArticleId,
  Grant,
  EUtilsConfig
} from '../types.js';
import {
  parseXML,
  extractText,
  parsePubMedDate,
  RateLimiter,
  retryWithBackoff,
  buildQueryString
} from './utils.js';

export class EUtilsClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;
  private config: EUtilsConfig;

  constructor(apiKey?: string, email?: string) {
    const requestsPerSecond = apiKey ? 10 : 3;

    this.config = {
      apiKey,
      email,
      tool: 'pubmed-mcp-server',
      baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
      rateLimit: requestsPerSecond
    };

    this.rateLimiter = new RateLimiter(requestsPerSecond);

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
      headers: {
        'User-Agent': 'PubMed-MCP-Server/1.0'
      }
    });
  }

  /**
   * Build common query parameters
   */
  private buildCommonParams(): Record<string, string> {
    const params: Record<string, string> = {
      tool: this.config.tool || 'pubmed-mcp-server'
    };

    if (this.config.apiKey) {
      params.api_key = this.config.apiKey;
    }

    if (this.config.email) {
      params.email = this.config.email;
    }

    return params;
  }

  /**
   * ESearch - Search and retrieve PMIDs
   */
  async search(params: SearchParams): Promise<SearchResult> {
    return this.rateLimiter.execute(async () => {
      return retryWithBackoff(async () => {
        const queryParams = {
          ...this.buildCommonParams(),
          db: 'pubmed',
          term: params.term,
          retmax: params.retmax || 20,
          retstart: params.retstart || 0,
          retmode: 'json',
          sort: params.sort,
          mindate: params.mindate,
          maxdate: params.maxdate,
          datetype: params.datetype || 'pdat',
          field: params.field
        };

        const response = await this.client.get('/esearch.fcgi' + buildQueryString(queryParams));
        const result = response.data.esearchresult;

        return {
          count: parseInt(result.count),
          retmax: parseInt(result.retmax),
          retstart: parseInt(result.retstart),
          pmids: result.idlist || [],
          translationSet: result.translationset,
          queryTranslation: result.querytranslation
        };
      });
    });
  }

  /**
   * EFetch - Retrieve article records
   */
  async fetch(params: FetchParams): Promise<any> {
    return this.rateLimiter.execute(async () => {
      return retryWithBackoff(async () => {
        const ids = Array.isArray(params.id) ? params.id.join(',') : params.id;

        const queryParams = {
          ...this.buildCommonParams(),
          db: params.db,
          id: ids,
          retmode: params.retmode || 'xml',
          rettype: params.rettype || 'abstract'
        };

        const response = await this.client.get('/efetch.fcgi' + buildQueryString(queryParams));

        if (params.retmode === 'json') {
          return response.data;
        }

        return await parseXML(response.data);
      });
    });
  }

  /**
   * ELink - Find related articles and citations
   */
  async link(params: LinkParams): Promise<any> {
    return this.rateLimiter.execute(async () => {
      return retryWithBackoff(async () => {
        const ids = Array.isArray(params.id) ? params.id.join(',') : params.id;

        const queryParams = {
          ...this.buildCommonParams(),
          dbfrom: params.dbfrom,
          db: params.db,
          id: ids,
          cmd: params.cmd || 'neighbor',
          linkname: params.linkname
        };

        const response = await this.client.get('/elink.fcgi' + buildQueryString(queryParams));
        return await parseXML(response.data);
      });
    });
  }

  /**
   * ESummary - Get document summaries
   */
  async summary(params: SummaryParams): Promise<any> {
    return this.rateLimiter.execute(async () => {
      return retryWithBackoff(async () => {
        const ids = Array.isArray(params.id) ? params.id.join(',') : params.id;

        const queryParams = {
          ...this.buildCommonParams(),
          db: params.db,
          id: ids,
          retmode: params.retmode || 'json'
        };

        const response = await this.client.get('/esummary.fcgi' + buildQueryString(queryParams));
        return response.data;
      });
    });
  }

  /**
   * Parse article from PubmedArticle XML
   */
  parseArticle(articleData: any): PubMedArticle {
    const medlineCitation = articleData.MedlineCitation || articleData;
    const article = medlineCitation.Article || {};
    const pmid = medlineCitation.PMID?._ || medlineCitation.PMID || '';

    // Parse authors
    const authors: Author[] = [];
    const authorList = article.AuthorList?.Author;
    if (authorList) {
      const authorArray = Array.isArray(authorList) ? authorList : [authorList];
      authorArray.forEach((author: any) => {
        if (author.CollectiveName) {
          authors.push({
            lastName: '',
            collectiveName: extractText(author.CollectiveName)
          });
        } else {
          authors.push({
            lastName: extractText(author.LastName || ''),
            foreName: extractText(author.ForeName || ''),
            initials: extractText(author.Initials || ''),
            affiliation: extractText(author.AffiliationInfo?.Affiliation || '')
          });
        }
      });
    }

    // Parse MeSH terms
    const meshTerms: MeshTerm[] = [];
    const meshHeadingList = medlineCitation.MeshHeadingList?.MeshHeading;
    if (meshHeadingList) {
      const meshArray = Array.isArray(meshHeadingList) ? meshHeadingList : [meshHeadingList];
      meshArray.forEach((mesh: any) => {
        const descriptor = mesh.DescriptorName;
        meshTerms.push({
          descriptorName: extractText(descriptor?._ || descriptor),
          qualifierName: extractText(mesh.QualifierName?._ || mesh.QualifierName || ''),
          majorTopic: descriptor?.MajorTopicYN === 'Y'
        });
      });
    }

    // Parse article IDs
    const articleIds: ArticleId[] = [];
    const pubmedData = articleData.PubmedData;
    if (pubmedData?.ArticleIdList?.ArticleId) {
      const idList = Array.isArray(pubmedData.ArticleIdList.ArticleId)
        ? pubmedData.ArticleIdList.ArticleId
        : [pubmedData.ArticleIdList.ArticleId];

      idList.forEach((id: any) => {
        articleIds.push({
          idType: id.IdType || 'unknown',
          value: extractText(id._ || id)
        });
      });
    }

    // Parse grants
    const grants: Grant[] = [];
    const grantList = article.GrantList?.Grant;
    if (grantList) {
      const grantArray = Array.isArray(grantList) ? grantList : [grantList];
      grantArray.forEach((grant: any) => {
        grants.push({
          grantId: extractText(grant.GrantID || ''),
          agency: extractText(grant.Agency || ''),
          country: extractText(grant.Country || '')
        });
      });
    }

    // Parse publication date
    const pubDate = article.Journal?.JournalIssue?.PubDate || {};
    const year = extractText(pubDate.Year || '');
    const month = extractText(pubDate.Month || '');
    const day = extractText(pubDate.Day || '');
    const dateStr = `${year} ${month} ${day}`.trim();

    // Parse abstract
    let abstract = '';
    const abstractText = article.Abstract?.AbstractText;
    if (abstractText) {
      if (Array.isArray(abstractText)) {
        abstract = abstractText.map((text: any) => {
          const label = text.Label ? `${text.Label}: ` : '';
          return label + extractText(text._ || text);
        }).join('\n\n');
      } else {
        abstract = extractText(abstractText._ || abstractText);
      }
    }

    // Parse publication types
    const publicationTypes: string[] = [];
    const pubTypeList = article.PublicationTypeList?.PublicationType;
    if (pubTypeList) {
      const typeArray = Array.isArray(pubTypeList) ? pubTypeList : [pubTypeList];
      typeArray.forEach((type: any) => {
        publicationTypes.push(extractText(type._ || type));
      });
    }

    // Parse keywords
    const keywords: string[] = [];
    const keywordList = medlineCitation.KeywordList?.Keyword;
    if (keywordList) {
      const keywordArray = Array.isArray(keywordList) ? keywordList : [keywordList];
      keywordArray.forEach((keyword: any) => {
        keywords.push(extractText(keyword._ || keyword));
      });
    }

    // Find DOI and PMCID
    const doi = articleIds.find(id => id.idType === 'doi')?.value;
    const pmcid = articleIds.find(id => id.idType === 'pmc')?.value;

    return {
      pmid,
      title: extractText(article.ArticleTitle || ''),
      abstract,
      authors,
      journal: extractText(article.Journal?.Title || article.Journal?.ISOAbbreviation || ''),
      publicationDate: parsePubMedDate(dateStr),
      doi,
      pmcid,
      articleIds,
      meshTerms,
      publicationTypes,
      keywords,
      volume: extractText(article.Journal?.JournalIssue?.Volume || ''),
      issue: extractText(article.Journal?.JournalIssue?.Issue || ''),
      pages: extractText(article.Pagination?.MedlinePgn || ''),
      language: extractText(article.Language || ''),
      grantList: grants.length > 0 ? grants : undefined
    };
  }

  /**
   * Get full article details by PMID
   */
  async getArticleDetails(pmid: string): Promise<PubMedArticle> {
    const result = await this.fetch({
      db: 'pubmed',
      id: pmid,
      retmode: 'xml',
      rettype: 'abstract'
    });

    const articleSet = result.PubmedArticleSet?.PubmedArticle || result.PubmedArticle;
    const article = Array.isArray(articleSet) ? articleSet[0] : articleSet;

    if (!article) {
      throw new Error(`Article not found for PMID: ${pmid}`);
    }

    return this.parseArticle(article);
  }

  /**
   * Get multiple articles by PMIDs
   */
  async getArticlesBatch(pmids: string[]): Promise<PubMedArticle[]> {
    if (pmids.length === 0) {
      return [];
    }

    const result = await this.fetch({
      db: 'pubmed',
      id: pmids,
      retmode: 'xml',
      rettype: 'abstract'
    });

    const articleSet = result.PubmedArticleSet?.PubmedArticle || result.PubmedArticle;
    if (!articleSet) {
      return [];
    }

    const articles = Array.isArray(articleSet) ? articleSet : [articleSet];
    return articles.map(article => this.parseArticle(article));
  }

  /**
   * Get cited by articles (articles that cite this PMID)
   */
  async getCitedBy(pmid: string): Promise<string[]> {
    const result = await this.link({
      dbfrom: 'pubmed',
      db: 'pubmed',
      id: pmid,
      linkname: 'pubmed_pubmed_citedin'
    });

    const linkSet = result.eLinkResult?.LinkSet;
    if (!linkSet) {
      return [];
    }

    const linkSetDb = linkSet.LinkSetDb;
    if (!linkSetDb) {
      return [];
    }

    const links = linkSetDb.Link;
    if (!links) {
      return [];
    }

    const linkArray = Array.isArray(links) ? links : [links];
    return linkArray.map((link: any) => extractText(link.Id));
  }

  /**
   * Get references (articles cited by this PMID)
   */
  async getReferences(pmid: string): Promise<string[]> {
    const result = await this.link({
      dbfrom: 'pubmed',
      db: 'pubmed',
      id: pmid,
      linkname: 'pubmed_pubmed_refs'
    });

    const linkSet = result.eLinkResult?.LinkSet;
    if (!linkSet) {
      return [];
    }

    const linkSetDb = linkSet.LinkSetDb;
    if (!linkSetDb) {
      return [];
    }

    const links = linkSetDb.Link;
    if (!links) {
      return [];
    }

    const linkArray = Array.isArray(links) ? links : [links];
    return linkArray.map((link: any) => extractText(link.Id));
  }

  /**
   * Get similar articles
   */
  async getSimilarArticles(pmid: string, maxResults: number = 20): Promise<string[]> {
    const result = await this.link({
      dbfrom: 'pubmed',
      db: 'pubmed',
      id: pmid,
      cmd: 'neighbor_score'
    });

    const linkSet = result.eLinkResult?.LinkSet;
    if (!linkSet) {
      return [];
    }

    const linkSetDb = linkSet.LinkSetDb;
    if (!linkSetDb) {
      return [];
    }

    const links = linkSetDb.Link;
    if (!links) {
      return [];
    }

    const linkArray = Array.isArray(links) ? links : [links];
    return linkArray
      .slice(0, maxResults)
      .map((link: any) => extractText(link.Id));
  }
}
