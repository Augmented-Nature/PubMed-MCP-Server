# PubMed MCP Server

A comprehensive Model Context Protocol (MCP) server that provides access to PubMed, NCBI's database of biomedical literature with over 36 million citations from MEDLINE, life science journals, and online books.

**Developed by [Augmented Nature](https://augmentednature.ai)**

## Overview

The PubMed MCP server exposes the full NCBI E-utilities and PubMed Central APIs through 16 specialized MCP tools, allowing you to search, retrieve, and analyze biomedical literature directly from your MCP-enabled environment.

## Features

### Search & Discovery Tools

- **search_articles** - Search PubMed by keywords, authors, journals, dates, or MeSH terms with pagination
- **advanced_search** - Complex queries with field-specific searches and boolean operators (AND/OR)
- **search_by_author** - Find articles by specific author(s) with optional affiliation filtering
- **search_by_journal** - Search within specific journals with date range filtering
- **search_by_mesh_terms** - Search using Medical Subject Headings (MeSH) with major topic filtering
- **get_trending_articles** - Get recently published articles in a specific field (last 30-365 days)

### Article Retrieval Tools

- **get_article_details** - Get comprehensive metadata and abstract for a specific PMID
- **get_abstract** - Retrieve article abstract by PMID with basic metadata
- **get_full_text** - Retrieve full text from PubMed Central (PMC) when available
- **batch_article_lookup** - Retrieve multiple articles efficiently (up to 200 PMIDs)

### Citation & Reference Tools

- **get_cited_by** - Find articles that cite a specific PMID
- **get_references** - Get reference list for an article
- **get_similar_articles** - Find related articles based on content similarity
- **export_citation** - Export citations in various formats (APA, MLA, Chicago, BibTeX, RIS)

### Utility Tools

- **validate_pmid** - Validate PubMed ID format and check if article exists
- **convert_identifiers** - Convert between PMID, DOI, and PMC ID

### Data Quality Features

- Real-time access to 36+ million biomedical citations
- Automatic rate limiting (3 req/s without API key, 10 req/s with key)
- Comprehensive error handling with retry logic
- Support for all PubMed search fields and operators
- MeSH term integration for precise medical queries
- Full-text access via PubMed Central when available

## Installation

### Prerequisites

- Node.js 16+ (install from [nodejs.org](https://nodejs.org))
- Optional: NCBI API key for higher rate limits (get from [NCBI Account Settings](https://www.ncbi.nlm.nih.gov/account/settings/))

### Basic Configuration (No API Key)

```json
{
  "mcpServers": {
    "pubmed-server": {
      "command": "node",
      "args": ["path/to/pubmed-server/build/index.js"],
      "autoApprove": [
        "search_articles",
        "get_article_details",
        "get_abstract",
        "validate_pmid"
      ]
    }
  }
}
```

### With API Key (Recommended for Higher Rate Limits)

```json
{
  "mcpServers": {
    "pubmed-server": {
      "command": "node",
      "args": ["path/to/pubmed-server/build/index.js"],
      "env": {
        "NCBI_API_KEY": "your_api_key_here",
        "NCBI_EMAIL": "your_email@example.com"
      },
      "autoApprove": [
        "search_articles",
        "get_article_details",
        "get_abstract",
        "validate_pmid",
        "search_by_author",
        "search_by_journal"
      ]
    }
  }
}
```

## Usage Examples

### Search for Recent CRISPR Research

```json
{
  "query": "CRISPR gene editing",
  "max_results": 10,
  "sort": "pub_date"
}
```

### Get Article Details

```json
{
  "pmid": "41138228"
}
```

### Advanced Search with Multiple Criteria

```json
{
  "title": "machine learning",
  "author": "Smith J",
  "mesh_terms": ["Artificial Intelligence", "Diagnosis"],
  "boolean_operator": "AND",
  "max_results": 50
}
```

### Search by Author with Affiliation

```json
{
  "author_name": "Smith J",
  "affiliation": "Harvard Medical School",
  "max_results": 50
}
```

### Search Within Specific Journal

```json
{
  "journal_name": "Nature",
  "keywords": "cancer immunotherapy",
  "date_from": "2024/01/01",
  "date_to": "2025/12/31",
  "max_results": 25
}
```

### Search by MeSH Terms

```json
{
  "mesh_terms": ["COVID-19", "Vaccines"],
  "major_topic_only": true,
  "max_results": 50
}
```

### Get Trending Articles

```json
{
  "field": "artificial intelligence in medicine",
  "days": 30,
  "max_results": 20
}
```

### Get Full Text from PMC

```json
{
  "pmcid": "PMC1234567"
}
```

### Batch Article Lookup

```json
{
  "pmids": ["41138228", "41137959", "41137488"]
}
```

### Export Citation in BibTeX

```json
{
  "pmid": "41138228",
  "format": "bibtex"
}
```

### Find Citing Articles

```json
{
  "pmid": "12345678",
  "max_results": 100
}
```

### Convert Between Identifiers

```json
{
  "identifier": "10.1080/15476286.2025.2577449",
  "identifier_type": "doi"
}
```

## API Reference

### Search Parameters

**Common Parameters:**

- `query` - Search query (keywords, phrases, field tags)
- `max_results` - Number of results (1-1000, default: 20)
- `start` - Starting position for pagination (default: 0)
- `sort` - Sort order: relevance, pub_date, author, journal

**Date Parameters:**

- `date_from` - Start date (YYYY/MM/DD format)
- `date_to` - End date (YYYY/MM/DD format)

**Field Tags:**

- `[Title]` - Article title
- `[Author]` - Author name
- `[Journal]` - Journal name
- `[MeSH Terms]` - Medical Subject Headings
- `[Abstract]` - Abstract text
- `[Affiliation]` - Author affiliation
- `[Publication Type]` - Type of publication
- `[DOI]` - Digital Object Identifier

**Example:** `"Smith J[Author] AND cancer[Title]"`

### MeSH Terms

Medical Subject Headings (MeSH) is the NLM controlled vocabulary thesaurus used for indexing articles. Using MeSH terms provides more precise search results than keyword searches.

**Common MeSH Categories:**

- Diseases
- Chemicals and Drugs
- Analytical, Diagnostic and Therapeutic Techniques
- Anatomy
- Organisms
- Psychiatry and Psychology
- Phenomena and Processes

### Citation Formats

The server supports multiple citation formats:

- **APA** - American Psychological Association
- **MLA** - Modern Language Association
- **Chicago** - Chicago Manual of Style
- **BibTeX** - LaTeX bibliography format
- **RIS** - Research Information Systems format

### Response Format

All tools return structured JSON data including:

- Article metadata (PMID, title, authors, journal, publication date)
- Abstract text (when available)
- MeSH terms and keywords
- DOI and other identifiers
- Citation information
- Full-text availability status

### PMID Format

All PMIDs must be numeric strings (e.g., "12345678")

## Error Handling

The server includes comprehensive error handling for:

- **Network Issues**: Automatic retry with exponential backoff
- **Rate Limiting**: Automatic throttling to comply with NCBI policies
- **Invalid Parameters**: Clear error messages for validation failures
- **API Errors**: Proper HTTP status code handling
- **Missing Data**: Graceful handling of unavailable fields

Common error responses include:

```json
{
  "error": "Invalid PMID format: abc123",
  "isError": true
}
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Development with watch mode
npm run watch
```

### Key Dependencies

- `@modelcontextprotocol/sdk` - MCP server framework
- `axios` - HTTP client for API requests
- `xml2js` - XML parsing for PubMed responses
- TypeScript for type safety and development

## Data Sources

**E-utilities API**: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
**PubMed Central API**: https://www.ncbi.nlm.nih.gov/pmc/tools/developers/
**Coverage**: 36+ million citations from MEDLINE, life science journals, and online books
**Data Updates**: Real-time access to the latest publications

## Rate Limits

- **Without API key**: 3 requests per second
- **With API key**: 10 requests per second

The server automatically handles rate limiting to comply with NCBI's usage policies.

## Troubleshooting

1. **Server Connection Issues**:

   ```bash
   # Test server manually
   cd pubmed-server
   node build/index.js
   # Should show: "PubMed MCP Server running on stdio"
   ```

2. **Invalid PMID Errors**:

   - Ensure PMIDs are numeric strings
   - Example: "12345678" ✓, "PMID12345678" ✗

3. **No Results Returned**:

   - Check search query syntax
   - Try broader search terms
   - Verify field tags are correct

4. **Rate Limit Errors**:

   - Consider obtaining an NCBI API key
   - Reduce request frequency
   - Use batch operations when possible

5. **Full Text Not Available**:
   - Not all articles have full text in PMC
   - Check if article has a PMC ID
   - Some articles may be behind paywalls

## Research Use Cases

- **Literature Review**: Comprehensive search across biomedical literature
- **Citation Analysis**: Track citations and references for research impact
- **Systematic Reviews**: Batch retrieval and analysis of multiple articles
- **Meta-Analysis**: Collect data from multiple studies efficiently
- **Research Trends**: Identify trending topics and recent publications
- **Author Research**: Find all publications by specific researchers
- **Journal Analysis**: Analyze publication patterns in specific journals
- **MeSH-Based Discovery**: Precise medical subject searches

## Compliance & Ethics

This server provides access to publicly available biomedical literature from PubMed. Users should:

- Follow institutional policies for research and publication
- Respect copyright and licensing terms for full-text articles
- Cite sources appropriately in publications
- Use data for legitimate research and educational purposes
- Comply with NCBI's usage policies and rate limits

## License

MIT License - See LICENSE file for details

---

**Data Source**: PubMed/NCBI (https://pubmed.ncbi.nlm.nih.gov)
**API Documentation**: https://www.ncbi.nlm.nih.gov/books/NBK25501/
**Server Version**: 1.0.0
