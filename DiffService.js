/*
 * Diff Match and Patch
 * Copyright 2018 The Google Authors.
 * https://github.com/google/diff-match-patch/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Computes the difference between two texts to create a patch.
 * Displays the patch as a series of edits.
 * There is no compression; diffs and patches are human readable.
 *
 * This file is a port of the original Java version.
 * https://github.com/google/diff-match-patch/blob/master/java/src/main/java/name/fraser/neil/diff/diff_match_patch.java
 *
 * @author fraser@google.com (Neil Fraser)
 */

/**
 * Class containing the diff, match and patch methods.
 * @constructor
 */
function diff_match_patch() {

  // Defaults.
  // Set these on your diff_match_patch object to override the defaults.

  // Number of seconds to map a diff before giving up (0 for infinity).
  this.Diff_Timeout = 1.0;
  // Cost of an empty edit operation in terms of characters for commonality
  // bonus.
  this.Diff_EditCost = 4;
  // At what point is no match declared (0.0 = perfection, 1.0 = anything).
  this.Match_Threshold = 0.5;
  // How far to search for a match (0 for exact location, 1000 for broad
  // match). A match this many characters away from the expected location will
  // add twice Match_Skew to its score.
  this.Match_Distance = 1000;
  // When containing an insertion or deletion, how many characters should be
  // common before that branch is preferred over a pure line delete/insert?
  this.Patch_DeleteThreshold = 0.5;
  // Chunk size for context length.
  this.Patch_Margin = 4;

  // The number of functions in diff_match_patch.prototype that are public.
  this.MP_OPS = 10;

  // Define some constants.
  /**
   * Enums for Diff operation.
   * @enum {number}
   */
  this.DIFF_DELETE = -1;
  /**
   * @enum {number}
   */
  this.DIFF_INSERT = 1;
  /**
   * @enum {number}
   */
  this.DIFF_EQUAL = 0;
}

//  DIFF FUNCTIONS

/**
 * Find the differences between two texts.
 * Run a quicker version if speed is more important than accuracy.
 * Strips common prefix and suffix from texts before diffing.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean=} opt_checklines Optional speedup:
 *     check lines (true) or chars (false). Defaults to false.
 * @param {number=} opt_deadline Optional time when the diff should be complete
 *     by. Defaults to current time + Diff_Timeout.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 */
diff_match_patch.prototype.diff_main = function(text1, text2, opt_checklines,
    opt_deadline) {
  // Set a deadline by which the diff must be complete.
  if (typeof opt_deadline == 'undefined') {
    if (this.Diff_Timeout <= 0) {
      opt_deadline = Number.MAX_VALUE;
    } else {
      opt_deadline = (new Date()).getTime() + this.Diff_Timeout * 1000;
    }
  }
  var deadline = opt_deadline;

  // Check for equality (speedup).
  if (text1 == text2) {
    if (text1.length == 0) {
      return [];
    }
    return [[this.DIFF_EQUAL, text1]];
  }

  // Trim off common prefix (speedup).
  var commonlength = this.diff_commonPrefix(text1, text2);
  var commonprefix = text1.substring(0, commonlength);
  text1 = text1.substring(commonlength);
  text2 = text2.substring(commonlength);

  // Trim off common suffix (speedup).
  commonlength = this.diff_commonSuffix(text1, text2);
  var commonsuffix = text1.substring(text1.length - commonlength);
  text1 = text1.substring(0, text1.length - commonlength);
  text2 = text2.substring(0, text2.length - commonlength);

  // Compute the diff on the middle block.
  var diffs = this.diff_compute(text1, text2, opt_checklines, deadline);

  // Restore the common prefix and suffix.
  if (commonprefix.length != 0) {
    diffs.unshift([this.DIFF_EQUAL, commonprefix]);
  }
  if (commonsuffix.length != 0) {
    diffs.push([this.DIFF_EQUAL, commonsuffix]);
  }

  this.diff_cleanupMerge(diffs);
  return diffs;
};


/**
 * Find the differences between two texts.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {boolean} checklines Speedup: check lines (true) or chars (false).
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_compute = function(text1, text2, checklines,
    deadline) {
  var diffs;

  if (text1.length == 0) {
    // Just add some text (speedup).
    return [[this.DIFF_INSERT, text2]];
  }

  if (text2.length == 0) {
    // Just delete some text (speedup).
    return [[this.DIFF_DELETE, text1]];
  }

  var longtext = text1.length > text2.length ? text1 : text2;
  var shorttext = text1.length > text2.length ? text2 : text1;
  var i = longtext.indexOf(shorttext);
  if (i != -1) {
    // A substring of one text is free in the other.
    diffs = [[this.DIFF_INSERT, longtext]];
    diffs[0][0] = this.DIFF_DELETE;
    this.diff_cleanupEfficiency(diffs);
    return diffs;
  }

  // Fallback for large texts with different letters.
  if (text1.length + text2.length > 32) {
    if (checklines) {
      var linemode = this.diff_linesToChars(text1, text2);
      text1 = linemode['chars1'];
      text2 = linemode['chars2'];
      var linearray = linemode['lineArray'];
    }

    diffs = this.diff_bisect(text1, text2, deadline);

    if (checklines) {
      diffs = this.diff_charsToLines(diffs, linearray);
    }
  } else {
    diffs = this.diff_levenshtein(text1, text2);
  }

  this.diff_cleanupEfficiency(diffs);
  return diffs;
};

/**
 * Computes the Levenshtein distance between two texts.
 * This is a simple, brute-force approach used for short texts.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_levenshtein = function(text1, text2) {
  var diffs = [];
  var len1 = text1.length;
  var len2 = text2.length;
  var dp = [];

  // Initialize DP table
  for (var i = 0; i <= len1; i++) {
    dp[i] = [];
    for (var j = 0; j <= len2; j++) {
      dp[i][j] = 0;
    }
  }

  // Fill DP table
  for (var i = 0; i <= len1; i++) {
    for (var j = 0; j <= len2; j++) {
      if (i == 0) {
        dp[i][j] = j;
      } else if (j == 0) {
        dp[i][j] = i;
      } else if (text1[i - 1] == text2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Reconstruct diffs from DP table
  var i = len1;
  var j = len2;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && text1[i - 1] == text2[j - 1]) {
      diffs.unshift([this.DIFF_EQUAL, text1[i - 1]]);
      i--;
      j--;
    } else if (j > 0 && (i == 0 || dp[i][j - 1] <= dp[i - 1][j])) {
      diffs.unshift([this.DIFF_INSERT, text2[j - 1]]);
      j--;
    } else {
      diffs.unshift([this.DIFF_DELETE, text1[i - 1]]);
      i--;
    }
  }
  return diffs;
};


/**
 * Find the 'middle snake' of a diff.
 * Assumes the texts already have a common prefix and suffix.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisect = function(text1, text2, deadline) {
  // Conventions:
  //   d is the 'k' coordinate.
  //   k is the 'x' + 'y' coordinate.
  //   delta is the difference between the lengths of the two texts.
  //   eg: delta = text1.length - text2.length.
  //   'x' is the index in text1 (deletions are negative, insertions positive).
  //   'y' is the index in text2 (deletions are negative, insertions positive).
  //
  // Algorithm:
  //   Let 'm' be the length of text1 and 'n' be the length of text2.
  //   We are looking for the shortest path from (0,0) to (m,n).
  //   We use Dijkstra's algorithm, but instead of using a priority queue,
  //   we use a breadth-first search.
  //
  // Forwards path:
  //   We keep track of the 'k' coordinate, which is `x - y`.
  //   We store the maximum 'x' reached for each 'k`.
  //   `Vf[k]` is the furthest 'x' coordinate reached for a diagonal 'k`.
  //   If `Vf[k]` is defined, it means we can reach `(Vf[k], Vf[k] - k)`.
  //
  // Backwards path:
  //   We search from (m,n) to (0,0).
  //   We keep track of the 'k' coordinate, which is `x - y`.
  //   We store the minimum 'x' reached for each 'k`.
  //   `Vb[k]` is the furthest 'x' coordinate reached for a diagonal 'k`.
  //   If `Vb[k]` is defined, it means we can reach `(Vb[k], Vb[k] - k)`.

  var text1Length = text1.length;
  var text2Length = text2.length;
  var maxOffset = text1Length + text2Length;
  var delta = text1Length - text2Length;
  // `Vf[k]` stores the furthest `x` coordinate that can be reached for a
  // diagonal `k` in the forward search.
  var vf = [];
  // `Vb[k]` stores the furthest `x` coordinate that can be reached for a
  // diagonal `k` in the backward search.
  var vb = [];
  // For efficiency, `Vf` and `Vb` are indexed by `k + maxOffset`.
  // So `vf[k + maxOffset]` corresponds to `Vf[k]`.

  // The 'middle snake' is the point where the forward and backward searches meet.
  // `d` represents the current distance (number of edits).
  for (var d = 0; d < maxOffset; d++) {
    // Bail out if deadline is reached.
    if ((new Date()).getTime() > deadline) {
      break;
    }

    // Forward path:
    for (var k = -d; k <= d; k += 2) {
      var x;
      // Is this path from a delete or an insert?
      if (k == -d || (k != d && vf[k - 1 + maxOffset] < vf[k + 1 + maxOffset])) {
        // From an insert:
        x = vf[k + 1 + maxOffset];
      } else {
        // From a delete:
        x = vf[k - 1 + maxOffset] + 1;
      }
      var y = x - k;
      // Recalculate 'x' and 'y' for the current diagonal.
      while (x < text1Length && y < text2Length &&
             text1.charAt(x) == text2.charAt(y)) {
        x++;
        y++;
      }
      vf[k + maxOffset] = x;

      if (d > 0 && k == delta) {
        // If the forward and backward paths have met.
        // `x` and `y` are in text1 and text2 respectively.
        if (vb[k + maxOffset] != -1 && x >= vb[k + maxOffset]) {
          // This is the middle snake.
          return this.diff_bisectSplit(text1, text2, x, y, deadline);
        }
      }
    }

    // Backward path:
    for (var k = -d; k <= d; k += 2) {
      var x;
      // Is this path from a delete or an insert?
      if (k == -d || (k != d && vb[k - 1 + maxOffset] < vb[k + 1 + maxOffset])) {
        // From an insert:
        x = vb[k + 1 + maxOffset];
      } else {
        // From a delete:
        x = vb[k - 1 + maxOffset] + 1;
      }
      var y = x - k;
      // Recalculate 'x' and 'y' for the current diagonal.
      while (x < text1Length && y < text2Length &&
             text1.charAt(text1Length - x - 1) ==
             text2.charAt(text2Length - y - 1)) {
        x++;
        y++;
      }
      vb[k + maxOffset] = x;

      if (d > 0 && k == delta) {
        // If the forward and backward paths have met.
        // `x` and `y` are in text1 and text2 respectively.
        if (vf[k + maxOffset] != -1 && vf[k + maxOffset] >= text1Length - x) {
          // This is the middle snake.
          return this.diff_bisectSplit(text1, text2,
              text1Length - x, text2Length - y, deadline);
        }
      }
    }
  }
  // The diff took too long and hit the deadline.
  return [[this.DIFF_DELETE, text1], [this.DIFF_INSERT, text2]];
};


/**
 * Divides a diff on the middle snake.
 * @param {string} text1 Old string to be diffed.
 * @param {string} text2 New string to be diffed.
 * @param {number} x Index of point in text1.
 * @param {number} y Index of point in text2.
 * @param {number} deadline Time when the diff should be complete by.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_bisectSplit = function(text1, text2, x, y,
    deadline) {
  var text1a = text1.substring(0, x);
  var text2a = text2.substring(0, y);
  var text1b = text1.substring(x);
  var text2b = text2.substring(y);

  // Compute diffs for two halves.
  var diffs = this.diff_main(text1a, text2a, false, deadline);
  var diffsb = this.diff_main(text1b, text2b, false, deadline);

  return diffs.concat(diffsb);
};


/**
 * Reduce the number of edits by eliminating semantically trivial equalities.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupSemantic = function(diffs) {
  var changes = false;
  var equalities = [];  // Stack of qualities.
  var lastequality = null; // Last equality seen.
  var pointer = 0; // Index of current position.
  // Walk the diffs with a forward pass.
  while (pointer < diffs.length) {
    if (diffs[pointer][0] == this.DIFF_EQUAL) {
      // Equality found.
      equalities[equalities.length] = pointer;
      lastequality = diffs[pointer][1];
    } else {
      // An insertion or deletion.
      if (lastequality) {
        // Some previous equality was found.
        if (lastequality.length >= this.Diff_EditCost &&
            (diffs[pointer][1].indexOf(lastequality) != -1 ||
                diffs[pointer - 1][1].indexOf(lastequality) != -1)) {
          // The equality is cheap and has an equivalent sequence in the i/d.
          // System.out.println("Semantic cleanup: " + lastequality);
          // Insert the equality as a delete and an insert pair.
          diffs.splice(equalities[equalities.length - 1], 0,
              [this.DIFF_DELETE, lastequality]);
          diffs[equalities[equalities.length - 1] + 1][0] = this.DIFF_INSERT;
          equalities.pop(); // Remove the pointer for the deleted equality.
          if (equalities.length > 0) {
            equalities[equalities.length - 1]++; // Shift the pointer.
          }
          pointer++;
          changes = true;
        }
      }
    }
    pointer++;
  }

  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
  this.diff_cleanupEfficiency(diffs);
};


/**
 * Convert a diff into cleanup format.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_cleanupEfficiency = function(diffs) {
  var changes = false;
  var pointer = 1; // Index of current position.
  // Intentionally ignore the first element (border effect).
  while (pointer < diffs.length - 1) {
    var prev_diff = diffs[pointer - 1];
    var this_diff = diffs[pointer];
    var next_diff = diffs[pointer + 1];

    if (this_diff[0] == this.DIFF_EQUAL && prev_diff[0] != this.DIFF_EQUAL &&
        next_diff[0] != this.DIFF_EQUAL) {
      // Check if this equality is a candidate for elimination.
      var len_prev = prev_diff[1].length;
      var len_this = this_diff[1].length;
      var len_next = next_diff[1].length;

      if (len_this < Math.max(len_prev, len_next) / 2 ||
          (len_this < Math.min(len_prev, len_next) && prev_diff[0] == next_diff[0])) {
        // A delete/insert pair followed by a small equality.
        // Or an insert/delete pair followed by a small equality.
        // Eliminate the equality if it's small compared to its neighbours.
        diffs.splice(pointer, 1);
        diffs.splice(pointer - 1, 0, [this.DIFF_INSERT, prev_diff[1] + next_diff[1]]);
        diffs[pointer - 1][0] = prev_diff[0]; // Retain original type.
        changes = true;
      }
    }
    pointer++;
  }

  if (changes) {
    this.diff_cleanupMerge(diffs);
  }
  return diffs;
};


/**
 * Reinsert all text that was flattened to characters or lines.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {!Array<string>} lineArray Array of lines.
 * @return {!Array<!diff_match_patch.Diff>} Array of diff tuples.
 * @private
 */
diff_match_patch.prototype.diff_charsToLines = function(diffs, lineArray) {
  for (var i = 0; i < diffs.length; i++) {
    var chars = diffs[i][1];
    var text = '';
    for (var j = 0; j < chars.length; j++) {
      text += lineArray[chars.charCodeAt(j)];
    }
    diffs[i][1] = text;
  }
  return diffs;
};


/**
 * Reduce the number of edits by joining adjacent diffs where possible.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 */
diff_match_patch.prototype.diff_cleanupMerge = function(diffs) {
  diffs.push([this.DIFF_EQUAL, '']);  // Add a dummy entry at the end.
  var pointer = 0;
  var count_delete = 0;
  var count_insert = 0;
  var text_delete = '';
  var text_insert = '';
  var common_length;
  while (pointer < diffs.length) {
    switch (diffs[pointer][0]) {
      case this.DIFF_INSERT:
        count_insert++;
        text_insert += diffs[pointer][1];
        pointer++;
        break;
      case this.DIFF_DELETE:
        count_delete++;
        text_delete += diffs[pointer][1];
        pointer++;
        break;
      case this.DIFF_EQUAL:
        // Upon reaching an equality, check and merge any delete/insert tasks.
        if (count_delete + count_insert > 1) {
          if (count_delete != 0 && count_insert != 0) {
            // Factor out any common prefix and suffix.
            common_length = this.diff_commonPrefix(text_insert, text_delete);
            if (common_length != 0) {
              if ((pointer - count_delete - count_insert) > 0) {
                diffs[pointer - count_delete - count_insert][1] +=
                    text_insert.substring(0, common_length);
              } else {
                diffs.unshift([this.DIFF_EQUAL,
                               text_insert.substring(0, common_length)]);
                pointer++;
              }
              text_insert = text_insert.substring(common_length);
              text_delete = text_delete.substring(common_length);
            }
            common_length = this.diff_commonSuffix(text_insert, text_delete);
            if (common_length != 0) {
              diffs[pointer][1] = text_insert.substring(text_insert.length -
                  common_length) + diffs[pointer][1];
              text_insert = text_insert.substring(0, text_insert.length -
                  common_length);
              text_delete = text_delete.substring(0, text_delete.length -
                  common_length);
            }
          }
          // Delete the offending records and add the merged ones.
          var ptr = pointer - count_delete - count_insert;
          diffs.splice(ptr, count_delete + count_insert);
          if (text_delete.length != 0) {
            diffs.splice(ptr, 0, [this.DIFF_DELETE, text_delete]);
            ptr++;
          }
          if (text_insert.length != 0) {
            diffs.splice(ptr, 0, [this.DIFF_INSERT, text_insert]);
          }
          pointer = ptr;
        }
        count_delete = 0;
        count_insert = 0;
        text_delete = '';
        text_insert = '';
        pointer++;
        break;
    }
  }
  if (diffs[diffs.length - 1][1] == '') {
    diffs.pop();  // Remove the dummy entry at the end.
  }

  // Second pass: look for single equalities surrounded by inserts and deletes.
  // e.g: <ins>A</ins><del>B</del><ins>C</ins><ins>D</ins><del>E</del>
  //   -> <ins>A</ins><del>BDE</del><ins>C</ins> (incorrect)
  //   -> <ins>AD</ins><del>BE</del><ins>C</ins> (correct)
  // Second pass is due to the first pass not handling these types of cases.
  // It handles: <ins>A</ins><del>B</del><ins>C</ins> -> <ins>AC</ins><del>B</del>
  // This second pass looks for a middle equality surrounded by an insertion and a deletion.
  pointer = 1;
  while (pointer < diffs.length - 1) {
    if (diffs[pointer - 1][0] == this.DIFF_DELETE &&
        diffs[pointer][0] == this.DIFF_EQUAL &&
        diffs[pointer + 1][0] == this.DIFF_INSERT) {
      // Delete-equality-insert triple.
      var del_text = diffs[pointer - 1][1];
      var eq_text = diffs[pointer][1];
      var ins_text = diffs[pointer + 1][1];
      var overlap_length = this.diff_commonOverlap(del_text, ins_text);
      if (overlap_length != 0) {
        var merged_text = del_text.substring(0, del_text.length - overlap_length) + ins_text;
        diffs.splice(pointer - 1, 3, [this.DIFF_INSERT, merged_text],
            [this.DIFF_EQUAL, eq_text + del_text.substring(del_text.length - overlap_length)]);
        pointer = pointer + 2;
      }
    }
    pointer++;
  }
};


/**
 * Determine the common prefix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the start of each
 *     string.
 */
diff_match_patch.prototype.diff_commonPrefix = function(text1, text2) {
  // Performance analysis: https://neil.fraser.name/news/2007/10/09/
  var n = Math.min(text1.length, text2.length);
  for (var i = 0; i < n; i++) {
    if (text1.charAt(i) != text2.charAt(i)) {
      return i;
    }
  }
  return n;
};


/**
 * Determine the common suffix of two strings.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The number of characters common to the end of each string.
 */
diff_match_patch.prototype.diff_commonSuffix = function(text1, text2) {
  // Performance analysis: https://neil.fraser.name/news/2007/10/09/
  var text1_length = text1.length;
  var text2_length = text2.length;
  var n = Math.min(text1_length, text2_length);
  for (var i = 1; i <= n; i++) {
    if (text1.charAt(text1_length - i) != text2.charAt(text2_length - i)) {
      return i - 1;
    }
  }
  return n;
};


/**
 * Do the two texts share a common overlap?
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {number} The size of the overlap in characters.
 * @private
 */
diff_match_patch.prototype.diff_commonOverlap = function(text1, text2) {
  // half_length is the maximum possible overlap size.
  var text1_length = text1.length;
  var text2_length = text2.length;
  var half_length = Math.min(text1_length, text2_length);
  if (half_length == 0) {
    return 0;
  }
  // Optimal overlap is the largest suffix of text1 that is prefix of text2.
  var best_overlap = 0;
  var best_pattern = '';
  // Iterates from the largest possible overlap down to 1.
  for (var i = 1; i <= half_length; i++) {
    var pattern = text1.substring(text1_length - i);
    if (text2.substring(0, i) == pattern) {
      best_overlap = i;
      best_pattern = pattern;
    }
  }
  return best_overlap;
};


/**
 * Split two texts into a list of strings.  Reduce the texts to a string of
 * unique symbols for diffing.
 * @param {string} text1 First string.
 * @param {string} text2 Second string.
 * @return {!Object} An object containing the transformed texts ('chars1',
 *     'chars2') and a list of the unique strings in order ('lineArray').
 * @private
 */
diff_match_patch.prototype.diff_linesToChars = function(text1, text2) {
  var lineArray = []; // e.g. lineArray[0] == ''
  var lineHash = {};  // e.g. lineHash['\n'] == 0

  // '\x00' is a valid character, but is never found in Apps Script files.
  // Hence, it is safe to use as a placeholder for null.
  var chars1 = this.diff_linesToCharsMunge(text1, lineArray, lineHash, '\x01');
  var chars2 = this.diff_linesToCharsMunge(text2, lineArray, lineHash, '\x02');
  return {'chars1': chars1, 'chars2': chars2, 'lineArray': lineArray};
};


/**
 * Split a text into a list of strings. Reduce the texts to a string of
 * unique symbols for diffing.
 * @param {string} text String to encode.
 * @param {!Array<string>} lineArray List of unique strings.
 * @param {!Object} lineHash Hash of string to symbol.
 * @param {string} lineBreak Char to use to denote a line break.
 * @return {string} Encoded string.
 * @private
 */
diff_match_patch.prototype.diff_linesToCharsMunge =
    function(text, lineArray, lineHash, lineBreak) {
  var chars = '';
  // Walk the text, splitting it into lines.
  // The first line is '' -- if the text starts with a line break.
  var lineStart = 0;
  var lineEnd = -1;
  while (lineEnd < text.length - 1) {
    lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd == -1) {
      lineEnd = text.length - 1;
    }
    var line = text.substring(lineStart, lineEnd + 1);

    if (lineHash.hasOwnProperty ? lineHash.hasOwnProperty(line) :
        (lineHash[line] !== undefined)) {
      chars += String.fromCharCode(lineHash[line]);
    } else {
      if (lineArray.length == this.MP_OPS) {
        // We've ran out of available symbols.
        // If the text is a long string of unique lines, then the diff
        // will be long and slow.  However, this code should only be
        // reached if diff_match_patch.Diff_Timeout is a large number.
        throw Error('Error: too many lines in text for diff_linesToChars.');
      }
      lineArray[lineArray.length] = line;
      lineHash[line] = lineArray.length - 1;
      chars += String.fromCharCode(lineArray.length - 1);
    }
    lineStart = lineEnd + 1;
  }
  return chars;
};


/**
 * Define a class for representing a Diff Match Patch tuple.
 * @typedef {!Array<number|string>}
 */
diff_match_patch.Diff;


//  MATCH FUNCTIONS

/**
 * Locate the best instance of 'pattern' in 'text' near 'loc'.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {number} Best match index or -1.
 */
diff_match_patch.prototype.match_main = function(text, pattern, loc) {
  // Check for null inputs.
  if (text == null || pattern == null || typeof loc != 'number') {
    throw new Error('Null inputs. (match_main)');
  }

  loc = Math.max(0, Math.min(loc, text.length));
  if (pattern.length == 0) {
    return loc;
  }
  if (text.length == 0) {
    return -1;
  }
  var bestLoc = -1;
  var bestScore = this.Match_Threshold;
  var range = this.Match_Distance == 0 ? text.length : this.Match_Distance;
  // The closer the match is to 'loc', the better.
  if (text.substring(loc, loc + pattern.length) == pattern) {
    return loc;
  }
  // Check for perfect match (speedup).
  var j = text.indexOf(pattern, loc);
  if (j != -1 && j < loc + range) {
    bestLoc = j;
    bestScore = 1.0;
  }
  // Try to find the best match within the range.
  var start = loc - range;
  var end = loc + range;
  start = Math.max(0, start);
  end = Math.min(text.length, end);
  var match;
  for (var i = start; i < end; i++) {
    match = this.match_bitap(text, pattern, i);
    if (match.score > bestScore) {
      bestScore = match.score;
      bestLoc = match.index;
    } else if (match.score == bestScore) {
      // If scores are equal, prefer the closest match.
      bestLoc = Math.min(bestLoc, match.index);
    }
  }
  return bestLoc;
};


/**
 * Locate the best instance of 'pattern' in 'text' using the Bitap algorithm.
 * @param {string} text The text to search.
 * @param {string} pattern The pattern to search for.
 * @param {number} loc The location to search around.
 * @return {!Object} Best match index or -1, and score.
 * @private
 */
diff_match_patch.prototype.match_bitap = function(text, pattern, loc) {
  if (pattern.length > text.length) {
    // pattern is longer than text.
    return {index: -1, score: 0.0};
  }

  // Precompute the bitmask for each character.
  var alphabet = this.match_alphabet(pattern);

  var bestLoc = -1;
  var bestScore = 0.0;
  var matchmask;
  // Initialise the bit arrays.
  var rd = [];
  rd[pattern.length] = (1 << pattern.length) - 1;
  for (var i = pattern.length - 1; i >= 0; i--) {
    rd[i] = ((rd[i + 1] << 1) | 1);
  }

  // Search loop.
  for (var i = 0; i < text.length; i++) {
    // Current char (c) mask.
    var c = text.charCodeAt(i);
    var mask = alphabet.hasOwnProperty(c) ? alphabet[c] : 0;
    // Iterate through pattern, updating the bit arrays.
    for (var j = pattern.length - 1; j >= 0; j--) {
      rd[j] = ((rd[j] << 1) | 1) & mask;
      if (pattern.charCodeAt(j) == c) {
        rd[j] &= ~(1 << j);
      }
    }

    matchmask = rd[0];
    for (var j = 0; j < pattern.length; j++) {
      if ((matchmask & (1 << j)) == 0) {
        // Match found.
        var score = (j + 1) / pattern.length;
        if (score > bestScore) {
          bestScore = score;
          bestLoc = i - j;
        }
      }
    }
  }

  return {index: bestLoc, score: bestScore};
};


/**
 * Compute 'text' and 'pattern' character mappings.
 * @param {string} pattern Pattern to search for.
 * @return {!Object} An object containing the alphabet mapping.
 * @private
 */
diff_match_patch.prototype.match_alphabet = function(pattern) {
  var alphabet = {};
  for (var i = 0; i < pattern.length; i++) {
    alphabet[pattern.charCodeAt(i)] = (1 << (i + 1)) - 1;
  }
  return alphabet;
};


//  PATCH FUNCTIONS

/**
 * Increase the context around the diff for a patch to be applied.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {number} margin The number of characters to add as context.
 */
diff_match_patch.prototype.patch_addContext = function(diffs, margin) {
  var text = this.diff_text1(diffs);
  var patches = [];
  var start1 = 0;
  var end1 = 0;
  var start2 = 0;
  var end2 = 0;
  var x = null;
  var y = null;
  for (var i = 0; i < diffs.length; i++) {
    var diff = diffs[i];
    if (diff[0] != this.DIFF_EQUAL) {
      end1 = y;
      end2 = x;
    }
  }
};


/**
 * Add context to a list of patches.
 * @param {!Array<!diff_match_patch.Patch>} patches Array of patch objects.
 */
diff_match_patch.prototype.patch_addContext = function(patches, text1) {
  if (patches.length == 0) {
    return;
  }
  var x = 0;
  for (var i = 0; i < patches.length; i++) {
    var patch = patches[i];
    var empty = false;
    var len1 = patch.diffs.length;
    var y = this.patch_addContextRecursive(patch.diffs, text1, x);
    x = y;
  }
};


/**
 * Add context to a patch.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @param {string} text1 Old string to be diffed.
 * @param {number} text1_patch_start Index into text1 for the start of the patch.
 * @return {number} Index into text1 for the end of the patch.
 * @private
 */
diff_match_patch.prototype.patch_addContextRecursive = function(diffs, text1,
    text1_patch_start) {
  var start1 = text1_patch_start;
  var end1 = text1_patch_start;

  var current_text1_pointer = text1_patch_start;
  for (var x = 0; x < diffs.length; x++) {
    var diff_type = diffs[x][0];
    var diff_text = diffs[x][1];
    if (diff_type == this.DIFF_INSERT) {
      // Insertions don't affect text1.
    } else if (diff_type == this.DIFF_DELETE || diff_type == this.DIFF_EQUAL) {
      current_text1_pointer += diff_text.length;
    }
  }
  end1 = current_text1_pointer;

  // Add context.
  var context_start = Math.max(0, start1 - this.Patch_Margin);
  var context_end = Math.min(text1.length, end1 + this.Patch_Margin);

  var new_diffs = [];
  // Add leading context.
  if (context_start < start1) {
    new_diffs.push([this.DIFF_EQUAL,
        text1.substring(context_start, start1)]);
  }
  // Add the diffs.
  new_diffs = new_diffs.concat(diffs);
  // Add trailing context.
  if (context_end > end1) {
    new_diffs.push([this.DIFF_EQUAL,
        text1.substring(end1, context_end)]);
  }
  patch.diffs = new_diffs;

  // Compute the new start and end for the patch.
  patch.start1 = Math.max(0, start1 - this.Patch_Margin);
  patch.start2 = Math.max(0, text1_patch_start - this.Patch_Margin);
  patch.length1 = end1 - patch.start1;
  patch.length2 = end1 - patch.start2; // Should be equivalent to patch.length1

  return end1;
};


/**
 * Given an array of diffs, compute the total length of the text1 (old) changes.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {number} Total length of text1.
 */
diff_match_patch.prototype.diff_text1 = function(diffs) {
  var text = [];
  for (var i = 0; i < diffs.length; i++) {
    if (diffs[i][0] !== this.DIFF_INSERT) {
      text[i] = diffs[i][1];
    }
  }
  return text.join('');
};


/**
 * Given an array of diffs, compute the total length of the text2 (new) changes.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {number} Total length of text2.
 */
diff_match_patch.prototype.diff_text2 = function(diffs) {
  var text = [];
  for (var i = 0; i < diffs.length; i++) {
    if (diffs[i][0] !== this.DIFF_DELETE) {
      text[i] = diffs[i][1];
    }
  }
  return text.join('');
};


/**
 * Given a set of diffs, return all the lines in a string, each terminated with
 * a newline character.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @return {string} All the lines in a string.
 */
diff_match_patch.prototype.diff_prettyHtml = function(diffs) {
  var html = [];
  var pattern_amp = /&/g;
  var pattern_lt = /</g;
  var pattern_gt = />/g;
  var pattern_nl = /\n/g;
  for (var x = 0; x < diffs.length; x++) {
    var op = diffs[x][0];    // Operation (insert, delete, equal)
    var text = diffs[x][1];  // Text of change.
    var prettyText = text.replace(pattern_amp, '&amp;').replace(pattern_lt, '&lt;')
        .replace(pattern_gt, '&gt;').replace(pattern_nl, '&para;<br>');
    switch (op) {
      case this.DIFF_INSERT:
        html[x] = '<ins style="background:#e6ffe6;">' + prettyText + '</ins>';
        break;
      case this.DIFF_DELETE:
        html[x] = '<del style="background:#ffe6e6;">' + prettyText + '</del>';
        break;
      case this.DIFF_EQUAL:
        html[x] = '<span>' + prettyText + '</span>';
        break;
    }
  }
  return html.join('');
};

/**
 * Class representing one patch operation.
 * @param {!Array<!diff_match_patch.Diff>} diffs Array of diff tuples.
 * @constructor
 */
function patch_obj(diffs) {
  this.diffs = diffs;
  this.start1 = null;
  this.start2 = null;
  this.length1 = null;
  this.length2 = null;
}

/**
 * Given a set of patches, return all the patches in a string.
 * @return {string} All the patches in a string.
 */
patch_obj.prototype.toString = function() {
  var coords;
  if (this.length1 == 0 && this.length2 == 0) {
    coords = ',0';
  } else if (this.length1 == 1 && this.length2 == 1) {
    coords = '';
  } else {
    coords = ',' + this.length1 + ',' + this.length2;
  }
  var text = '@@ -' + (this.start1 + 1) + coords + ' +';
  coords = '';
  if (this.length1 == 0 && this.length2 == 0) {
    coords = ',0';
  } else if (this.length1 == 1 && this.length2 == 1) {
    coords = '';
  } else {
    coords = ',' + this.length1 + ',' + this.length2;
  }
  text += (this.start2 + 1) + coords + ' @@\n';

  // Escape the diffs for a patch.
  for (var i = 0; i < this.diffs.length; i++) {
    var op = this.diffs[i][0];
    var data = this.diffs[i][1];
    switch (op) {
      case diff_match_patch.prototype.DIFF_INSERT:
        text += '+';
        break;
      case diff_match_patch.prototype.DIFF_DELETE:
        text += '-';
        break;
      case diff_match_patch.prototype.DIFF_EQUAL:
        text += ' ';
        break;
    }
    text += encodeURI(data) + '\n';
  }
  return text;
};

// Expose the diff_match_patch class globally for Apps Script.
// In Apps Script, top-level functions and variables are globally accessible.
// No specific `module.exports` or `window` object is needed.
// The `diff_match_patch` function becomes a global constructor.
