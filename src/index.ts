import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

const TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search";

// Fields returned by default for a search (eForms field names).
const DEFAULT_FIELDS = [
	"publication-number",
	"notice-title",
	"notice-type",
	"contract-nature",
	"buyer-name",
	"buyer-country",
	"classification-cpv",
	"total-value",
	"total-value-cur",
	"publication-date",
	"deadline",
	"links",
];

const QUERY_HELP = `TED expert query syntax. Examples:
- Full text: FT~"unmanned aerial vehicle"
- Buyer country (ISO 3-letter): buyer-country=SWE
- CPV code: classification-cpv=35613000  (35* = security/defence equipment, 38115000 = radar)
- Published on/after date (YYYYMMDD): PD>=20260101
- Combine with AND / OR and parentheses; sort with: SORT BY publication-date DESC
Example: (classification-cpv=35613000 OR FT~"radar") AND buyer-country=SWE AND PD>=20260101 SORT BY publication-date DESC`;

async function tedSearch(body: Record<string, unknown>): Promise<string> {
	const res = await fetch(TED_SEARCH_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	if (!res.ok) {
		// Return TED's own error message so the query can be corrected.
		return `TED API error ${res.status}: ${text.slice(0, 2000)}`;
	}
	return text;
}

function createServer() {
	const server = new McpServer({
		name: "TED Tenders",
		version: "1.0.0",
	});

	server.registerTool(
		"search_ted_notices",
		{
			description:
				"Search EU public procurement notices on TED (Tenders Electronic Daily) with an expert query. " +
				"Use scope ACTIVE for tenders that are currently open, ALL to include past notices and contract awards.\n\n" +
				QUERY_HELP,
			inputSchema: z.object({
				query: z.string().describe("TED expert query, see examples in the tool description"),
				scope: z.enum(["ACTIVE", "ALL", "LATEST"]).default("ACTIVE"),
				limit: z.number().int().min(1).max(100).default(25),
				page: z.number().int().min(1).default(1),
				fields: z
					.array(z.string())
					.optional()
					.describe("Optional eForms field names to return; leave empty for sensible defaults"),
			}),
		},
		async ({ query, scope, limit, page, fields }) => {
			const text = await tedSearch({
				query,
				scope,
				limit,
				page,
				paginationMode: "PAGE_NUMBER",
				fields: fields && fields.length > 0 ? fields : DEFAULT_FIELDS,
			});
			return { content: [{ type: "text", text }] };
		},
	);

	server.registerTool(
		"get_ted_notice",
		{
			description:
				"Get one TED notice by its publication number (e.g. 686408-2025). Returns its main details and " +
				"links to the full notice in HTML, PDF and XML.",
			inputSchema: z.object({
				publication_number: z.string().describe("Publication number, e.g. 686408-2025"),
				fields: z.array(z.string()).optional(),
			}),
		},
		async ({ publication_number, fields }) => {
			const text = await tedSearch({
				query: `publication-number=${publication_number}`,
				scope: "ALL",
				limit: 1,
				fields: fields && fields.length > 0 ? fields : DEFAULT_FIELDS,
			});
			return { content: [{ type: "text", text }] };
		},
	);

	return server;
}

const handler = createMcpHandler(createServer);

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		return handler(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
