import {
  commentResolutionSchema,
  feedbackAnchorSchema,
  roundTransitionSchema,
  type ReviewArtifact,
  type ReviewComment,
  type ReviewRound,
  type ReviewSurfaceResponse,
} from "@doc-review/api-contracts";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ReviewService } from "./review.service";

const AUTHORED_HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; sandbox";

// GitHub remains read-only. The explicit reconcile POST advances local durable
// review state; GET handlers only read/stream it, except for issue #40's required
// merged-state deletion before a merged 404. Every upstream action stays on GitHub.
@Controller()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get("pr/:owner/:repo/:number")
  getReviewSurface(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
  ): Promise<ReviewSurfaceResponse> {
    return this.review.getReviewSurface(owner, repo, number);
  }

  @Post("pr/:owner/:repo/:number/review/reconcile")
  @HttpCode(HttpStatus.OK)
  reconcileReview(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
  ): Promise<ReviewRound> {
    return this.review.reconcileReview(owner, repo, number);
  }

  // The shared raw-byte route: the HTML authored comparison receives a no-egress CSP,
  // PDFs render inline, and the download fallback gets an attachment. The path and
  // optional exact-head ref ride as encoded query params (no mid-route wildcard).
  // `@Res()` writes the response directly, so the global ResponseInterceptor's JSON
  // envelope never wraps the bytes.
  @Get("pr/:owner/:repo/:number/raw")
  async getRawFile(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Query("path") path: string,
    @Query("ref") ref: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.review.getRawFile(owner, repo, number, path, ref);
    res.setHeader("Content-Type", file.contentType);
    if (file.contentType.startsWith("text/html")) {
      res.setHeader("Content-Security-Policy", AUTHORED_HTML_CSP);
    }
    if (!file.inline) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.filename}"`,
      );
    }
    res.send(file.bytes);
  }

  @Post("pr/:owner/:repo/:number/comments")
  createFeedback(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() body: unknown,
  ): Promise<ReviewComment> {
    const parsed = feedbackAnchorSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid feedback anchor");
    }
    return this.review.createFeedback(owner, repo, number, parsed.data);
  }

  // Partial-updates the current round's status: `finished` freezes it, `approved`
  // (zero unresolved) makes it terminal. Both return the round's read-only artifact.
  @Patch("pr/:owner/:repo/:number/review/current")
  transitionRound(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() body: unknown,
  ): Promise<ReviewArtifact> {
    const parsed = roundTransitionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid round transition");
    }
    return this.review.transitionRound(owner, repo, number, parsed.data.status);
  }

  // Partial-updates one comment on the current open round: `{ resolved: true }`
  // resolves it. Returns the updated comment.
  @Patch("pr/:owner/:repo/:number/comments/:commentId")
  resolveComment(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
    @Param("commentId") commentId: string,
    @Body() body: unknown,
  ): Promise<ReviewComment> {
    const parsed = commentResolutionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid comment resolution");
    }
    return this.review.resolveComment(owner, repo, number, commentId);
  }

  // Reads the current round's finish artifact; 409 while the round is still open.
  @Get("pr/:owner/:repo/:number/review/current")
  getCurrentArtifact(
    @Param("owner") owner: string,
    @Param("repo") repo: string,
    @Param("number", ParseIntPipe) number: number,
  ): Promise<ReviewArtifact> {
    return this.review.getCurrentArtifact(owner, repo, number);
  }
}
