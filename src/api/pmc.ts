/**
 * PubMed Central (PMC) API client
 * Documentation: https://www.ncbi.nlm.nih.gov/pmc/tools/developers/
 */

import axios, { AxiosInstance } from 'axios';
import { FullTextArticle, ArticleSection, Figure, Table, Reference } from '../types.js';
import { parseXML, extractText, RateLimiter, retryWithBackoff, normalizePMCID } from './utils.js';

export class PMCClient {
  private client: AxiosInstance;
  private rateLimiter: RateLimiter;

  constructor(apiKey?: string) {
    const requestsPerSecond = apiKey ? 10 : 3;
    this.rateLimiter = new RateLimiter(requestsPerSecond);

    this.client = axios.create({
      baseURL: 'https://www.ncbi.nlm.nih.gov/pmc',
      timeout: 30000,
      headers: {
        'User-Agent': 'PubMed-MCP-Server/1.0'
      }
    });
  }

  /**
   * Get full text article from PMC
   */
  async getFullText(pmcid: string): Promise<FullTextArticle> {
    return this.rateLimiter.execute(async () => {
      return retryWithBackoff(async () => {
        const normalizedId = normalizePMCID(pmcid);
        const response = await this.client.get(`/oai/oai.cgi`, {
          params: {
            verb: 'GetRecord',
            identifier: `oai:pubmedcentral.nih.gov:${normalizedId.replace('PMC', '')}`,
            metadataPrefix: 'pmc'
          }
        });

        const parsed = await parseXML(response.data);
        return this.parseFullTextArticle(parsed, normalizedId);
      });
    });
  }

  /**
   * Parse full text article from PMC XML
   */
  private parseFullTextArticle(data: any, pmcid: string): FullTextArticle {
    const record = data['OAI-PMH']?.GetRecord?.record;
    if (!record) {
      throw new Error(`Full text not found for ${pmcid}`);
    }

    const metadata = record.metadata?.article;
    if (!metadata) {
      throw new Error(`Invalid article metadata for ${pmcid}`);
    }

    const front = metadata.front;
    const body = metadata.body;
    const back = metadata.back;

    // Parse article metadata
    const articleMeta = front?.['article-meta'];
    const journalMeta = front?.['journal-meta'];

    // Parse title
    const titleGroup = articleMeta?.['title-group'];
    const title = extractText(titleGroup?.['article-title'] || '');

    // Parse authors
    const authors = this.parseAuthors(articleMeta?.['contrib-group']);

    // Parse abstract
    const abstract = this.parseAbstract(articleMeta?.abstract);

    // Parse publication date
    const pubDate = articleMeta?.['pub-date'];
    const publicationDate = this.parseDate(pubDate);

    // Parse journal
    const journal = extractText(journalMeta?.['journal-title'] || '');

    // Parse DOI
    const articleIds = articleMeta?.['article-id'];
    let doi = '';
    let pmid = '';

    if (articleIds) {
      const idArray = Array.isArray(articleIds) ? articleIds : [articleIds];
      idArray.forEach((id: any) => {
        if (id['pub-id-type'] === 'doi') {
          doi = extractText(id);
        } else if (id['pub-id-type'] === 'pmid') {
          pmid = extractText(id);
        }
      });
    }

    // Parse body sections
    const sections = this.parseSections(body?.sec);

    // Parse figures
    const figures = this.parseFigures(metadata.floats?.fig || body?.fig);

    // Parse tables
    const tables = this.parseTables(metadata.floats?.['table-wrap'] || body?.['table-wrap']);

    // Parse references
    const references = this.parseReferences(back?.['ref-list']?.ref);

    // Combine body text
    const bodyText = this.extractBodyText(sections);

    return {
      pmcid,
      pmid,
      title,
      abstract,
      body: bodyText,
      authors,
      journal,
      publicationDate,
      doi,
      sections,
      figures,
      tables,
      references
    };
  }

  /**
   * Parse authors from contrib-group
   */
  private parseAuthors(contribGroup: any): any[] {
    const authors: any[] = [];

    if (!contribGroup) {
      return authors;
    }

    const contribs = contribGroup.contrib;
    if (!contribs) {
      return authors;
    }

    const contribArray = Array.isArray(contribs) ? contribs : [contribs];

    contribArray.forEach((contrib: any) => {
      if (contrib['contrib-type'] === 'author') {
        const name = contrib.name;
        if (name) {
          authors.push({
            lastName: extractText(name.surname || ''),
            foreName: extractText(name['given-names'] || ''),
            initials: extractText(name['given-names'] || '').charAt(0),
            affiliation: extractText(contrib.aff || '')
          });
        }
      }
    });

    return authors;
  }

  /**
   * Parse abstract
   */
  private parseAbstract(abstractData: any): string {
    if (!abstractData) {
      return '';
    }

    if (typeof abstractData === 'string') {
      return abstractData;
    }

    // Handle structured abstracts
    const sections = abstractData.sec;
    if (sections) {
      const sectionArray = Array.isArray(sections) ? sections : [sections];
      return sectionArray.map((sec: any) => {
        const title = extractText(sec.title || '');
        const content = extractText(sec.p || '');
        return title ? `${title}: ${content}` : content;
      }).join('\n\n');
    }

    return extractText(abstractData.p || abstractData);
  }

  /**
   * Parse publication date
   */
  private parseDate(pubDate: any): string {
    if (!pubDate) {
      return '';
    }

    const dateObj = Array.isArray(pubDate) ? pubDate[0] : pubDate;
    const year = extractText(dateObj.year || '');
    const month = extractText(dateObj.month || '01').padStart(2, '0');
    const day = extractText(dateObj.day || '01').padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  /**
   * Parse body sections
   */
  private parseSections(sections: any): ArticleSection[] {
    if (!sections) {
      return [];
    }

    const sectionArray = Array.isArray(sections) ? sections : [sections];
    return sectionArray.map((sec: any) => this.parseSection(sec));
  }

  /**
   * Parse individual section
   */
  private parseSection(sec: any): ArticleSection {
    const title = extractText(sec.title || '');
    const paragraphs = sec.p;
    let content = '';

    if (paragraphs) {
      const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
      content = pArray.map((p: any) => extractText(p)).join('\n\n');
    }

    const subsections = sec.sec ? this.parseSections(sec.sec) : undefined;

    return {
      title,
      content,
      subsections
    };
  }

  /**
   * Parse figures
   */
  private parseFigures(figures: any): Figure[] {
    if (!figures) {
      return [];
    }

    const figArray = Array.isArray(figures) ? figures : [figures];
    return figArray.map((fig: any) => ({
      id: fig.id || '',
      label: extractText(fig.label || ''),
      caption: extractText(fig.caption?.p || fig.caption || ''),
      url: fig.graphic?.['xlink:href'] || ''
    }));
  }

  /**
   * Parse tables
   */
  private parseTables(tables: any): Table[] {
    if (!tables) {
      return [];
    }

    const tableArray = Array.isArray(tables) ? tables : [tables];
    return tableArray.map((table: any) => ({
      id: table.id || '',
      label: extractText(table.label || ''),
      caption: extractText(table.caption?.p || table.caption || ''),
      content: extractText(table.table || '')
    }));
  }

  /**
   * Parse references
   */
  private parseReferences(references: any): Reference[] {
    if (!references) {
      return [];
    }

    const refArray = Array.isArray(references) ? references : [references];
    return refArray.map((ref: any) => {
      const citation = ref['mixed-citation'] || ref['element-citation'] || ref.citation;
      const pubIds = ref['pub-id'];

      let pmid = '';
      let doi = '';

      if (pubIds) {
        const idArray = Array.isArray(pubIds) ? pubIds : [pubIds];
        idArray.forEach((id: any) => {
          if (id['pub-id-type'] === 'pmid') {
            pmid = extractText(id);
          } else if (id['pub-id-type'] === 'doi') {
            doi = extractText(id);
          }
        });
      }

      return {
        id: ref.id || '',
        citation: extractText(citation || ''),
        pmid,
        doi
      };
    });
  }

  /**
   * Extract body text from sections
   */
  private extractBodyText(sections: ArticleSection[]): string {
    return sections.map(sec => {
      let text = sec.title ? `${sec.title}\n\n` : '';
      text += sec.content;

      if (sec.subsections && sec.subsections.length > 0) {
        text += '\n\n' + this.extractBodyText(sec.subsections);
      }

      return text;
    }).join('\n\n');
  }

  /**
   * Check if full text is available for a PMCID
   */
  async isFullTextAvailable(pmcid: string): Promise<boolean> {
    try {
      await this.getFullText(pmcid);
      return true;
    } catch (error) {
      return false;
    }
  }
}
