import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";
import { verifyApi } from "./verify";

const app = new Hono();

// /verify/:name + /tickers — verification and the ticker registry.
app.route("/", verifyApi);

// SQL-over-HTTP for @ponder/client consumers.
app.use("/sql/*", client({ db, schema }));

// GraphQL at / and /graphql.
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
