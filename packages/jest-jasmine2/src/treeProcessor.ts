/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import Suite from './jasmine/Suite';

type Options = {
  nodeComplete: (suite: TreeNode) => void;
  nodeStart: (suite: TreeNode) => void;
  queueRunnerFactory: any;
  runnableIds: Array<string>;
  tree: TreeNode;
};

export type TreeNode = {
  afterAllFns: Array<any>;
  beforeAllFns: Array<any>;
  disabled?: boolean;
  execute: (onComplete: () => void, enabled: boolean) => void;
  id: string;
  onException: (error: Error) => void;
  sharedUserContext: () => any;
  children?: Array<TreeNode>;
  markedConcurrent: boolean;
} & Pick<Suite, 'getResult' | 'parentSuite' | 'result'>;

export default function treeProcessor(options: Options): void {
  const {
    nodeComplete,
    nodeStart,
    queueRunnerFactory,
    runnableIds,
    tree,
  } = options;

  function isEnabled(node: TreeNode, parentEnabled: boolean) {
    return parentEnabled || runnableIds.indexOf(node.id) !== -1;
  }

  function getNodeHandler(node: TreeNode, parentEnabled: boolean) {
    const enabled = isEnabled(node, parentEnabled);
    return node.children
      ? getNodeWithChildrenHandler(node, enabled)
      : getNodeWithoutChildrenHandler(node, enabled);
  }

  function getNodeWithoutChildrenHandler(node: TreeNode, enabled: boolean) {
    // this must be a leaf node (it)
    return function fn(done: (error?: any) => void = () => {}) {
      node.execute(done, enabled);
    };
  }

  function getNodeWithChildrenHandler(node: TreeNode, enabled: boolean) {
    // TODO mix of async and done here?
    return async function fn(done: (error?: any) => void = () => {}) {
      nodeStart(node);
      // this waits for current describe to finish?
      // is a node a describe? yes in this handler
      // makes sense describes run serially?
      // does beforeEach make sense? it would overwrite things
      // beforeAll and afterAll makes sense
      // queueRunner waits for done() before resolving
      await queueRunnerFactory({
        onException: (error: Error) => node.onException(error),
        // wrapChildren brings us back in here and adds beforeAll + afterAll
        // children need to be able to run in parallel. make a nested array of parallel ones
        // child might be a describe or an it, so concurrent flag could be on both :)
        queueableFns: wrapChildren(node, enabled),
        userContext: node.sharedUserContext(),
      });
      nodeComplete(node);
      done();
    };
  }

  function hasEnabledTest(node: TreeNode): boolean {
    if (node.children) {
      return node.children.some(hasEnabledTest);
    }
    return !node.disabled;
  }

  function wrapChildren(node: TreeNode, enabled: boolean) {
    if (!node.children) {
      throw new Error('`node.children` is not defined.');
    }

    const concurrent: Array<TreeNode> = [];
    const serial: Array<TreeNode> = [];
    node.children.forEach(child =>
      (child.markedConcurrent ? concurrent : serial).push(child),
    );

    const mapper = (child: TreeNode) => ({
      fn: getNodeHandler(child, enabled),
    });
    const wrapArray = (a: unknown) => [a];

    const children = [
      concurrent.map(mapper),
      ...serial.map(mapper).map(wrapArray),
    ];
    if (!hasEnabledTest(node)) {
      return children;
    }
    return [
      ...node.beforeAllFns.map(wrapArray),
      ...children,
      ...node.afterAllFns.map(wrapArray),
    ];
  }

  const treeHandler = getNodeHandler(tree, false);
  return treeHandler();
}
