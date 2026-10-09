import { scoringService } from "../services/scoring.service.js";

export class ScoreController {
  static async scorePosts(req, res) {
    const { posts, topics, site } = req.body;
    const result = await scoringService.scoreBatch({
      posts,
      topics,
      defaultSite: site,
    });
    res.status(200).json(result);
  }
}
