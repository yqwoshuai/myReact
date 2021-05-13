// 组合对象
const MyReact = {
	createElement,
	render,
	useState,
	useEffect
};

// 初始化阶段，启动渲染
function render(element, container) {
	// 定义根fiber节点，根fiber节点是容器节点，根fiber节点的子节点才是需要渲染的内容
	// 这是当前工作流中的根fiber节点
	wipRoot = {
		dom: container,
		props: {
			children: [element],
		},
		// 链接到上一次渲染的根fiber节点，即当前页面中已经显示的根fiber节点
		alternate: currentRoot,
	};
	// 开始任务前清空删除任务队列
	deletions = [];
	// 初始任务为处理根fiber节点
	nextUnitOfwork = wipRoot;
}

// 下一次需要执行的任务
let nextUnitOfwork = null;
// 当前页面渲染的根fiber节点
let currentRoot = null;
// 本次工作流中的根fiber节点
let wipRoot = null;
// 需要被删除的节点数组
let deletions = null;

// 定义任务队列
// 使用requestIdleCallback获取当前浏览器的空闲时间
// react已经不使用requestIdleCallback API了，react有专门的任务优先级判断逻辑
// 这里用这个requestIdleCallback API模拟
function workLoop(deadline) {
	// deadline是requestIdleCallback API传入的参数
	let shouldYield = false;
	// 当前有任务且浏览器有空闲时间时执行任务
	while (nextUnitOfwork && !shouldYield) {
		nextUnitOfwork = performUnitOfWork(nextUnitOfwork);
		shouldYield = deadline.timeRemaining() < 10;
	}

	// 所有任务都执行完毕后开始提交dom
	if (!nextUnitOfwork && wipRoot) {
		commitRoot();
	}
	// 空闲时间再次开始任务
	// 这样开启任务的话浏览器会在空闲时间内无限循环执行workLoop函数
	requestIdleCallback(workLoop);
}
// 流浪器空闲时间开启任务
requestIdleCallback(workLoop);

// 执行任务，并返回下一个任务
function performUnitOfWork(fiber) {
	// 判断当前fiber是否为函数组件，函数组件则执行对应操作
	const isFunctionComponent = fiber.type instanceof Function;
	if (isFunctionComponent) {
		updateFunctionComponent(fiber);
	} else {
		updateHostComponent(fiber);
	}
	// 寻找下一个工作单元
	// 当前fiber是否还有子节点，有子节点则返回子节点给下一次任务
	if (fiber.child) {
		return fiber.child;
	}
	// 没有子节点的fiber去找兄弟节点，没有兄弟节点的则去找父节点的兄弟节点
	let nextFiber = fiber;
	while (nextFiber) {
		if (nextFiber.sibling) {
			return nextFiber.sibling;
		}
		nextFiber = nextFiber.parent;
	}
}

// 当前工作流正在操作的fiber节点
let wipFiber = null;
// hooks索引
let hookIndex = null;

// 更新函数组件
function updateFunctionComponent(fiber) {
	// 每次创建函数组件都初始化hooks
	wipFiber = fiber;
	hookIndex = 0;
	wipFiber.hooks = [];
	// 执行函数获取对应的children属性
	const children = [fiber.type(fiber.props)];
	reconcileChildren(fiber, children);
}

//更新普通组件
function updateHostComponent(fiber) {
	// 给没有dom内容的fiber节点创建dom
	if (!fiber.dom) {
		fiber.dom = createDom(fiber);
	}
	reconcileChildren(fiber, fiber.props.children);
}

// 创建新的fiber节点 并规划fiber节点将要执行的任务
// 将对新旧fiber节点进行对比调和
function reconcileChildren(fiber, children) {
	let index = 0;
	// 通过alternate属性找到旧的fiber节点的子节点
	// alternate属性保存了上一次渲染中的fiber节点
	let oldFiber = fiber.alternate && fiber.alternate.child;
	let prevSibling = null;

	// 遍历所有子节点，创建每个节点的新节点数据
	while (index < children.length || oldFiber != null) {
		const child = children[index];
		let newFiber = null;

		// 判断新旧节点类型是否相同
		// react还有key值判断，这里简略直接判断type
		const sameType = oldFiber && child && child.type === oldFiber.type;
		// 类型相同表示可以复用dom
		if (sameType) {
			newFiber = {
				type: oldFiber.type,
				// 复用dom只需要更新props
				props: child.props,
				dom: oldFiber.dom,
				parent: fiber,
				alternate: oldFiber,
				// 标记为更新
				effectTag: "UPDATE",
			};
		}
		// 新子节点存在且类型与之前不相同，表示需要新增节点
		if (child && !sameType) {
			newFiber = {
				type: child.type,
				props: child.props,
				dom: null,
				parent: fiber,
				alternate: null,
				// 标记为新增
				effectTag: "PLACEMENT",
			};
		}
		// 就节点存在且类型不同，表示需要删除旧节点
		if (oldFiber && !sameType) {
			// 将旧fiber节点标记为删除
			oldFiber.effectTag = "DELETION";
			// 删除任务保存在数组中，统一执行
			deletions.push(oldFiber);
		}

		// 处理兄弟节点
		if (oldFiber) {
			oldFiber = oldFiber.sibling;
		}

		// 将fiber通过sibling属性串成链表
		if (index === 0) {
			// index为0表示处理的是根fiber节点的子节点
			fiber.child = newFiber;
		} else if (child) {
			prevSibling.sibling = newFiber;
		}
		// 将当前fiber赋值给prevSibling，处理下一个节点
		prevSibling = newFiber;
		index++;
	}
}

// 定义state hook
function useState(initial) {
	// alternate是当前fiber节点在currentRoot树中对应的节点
	const oldHook =
		wipFiber.alternate &&
		wipFiber.alternate.hooks &&
		wipFiber.alternate.hooks[hookIndex];
	// hook保存上一次渲染的状态
	const hook = {
		state: oldHook ? oldHook.state : initial,
		queue: [],
	};

	// 执行本次渲染的所有hooks，修改state状态，返回的state状态就会被更新
	const actions = oldHook ? oldHook.queue : [];
	actions.forEach((action) => {
		// setState传入的是函数则执行函数，不是函数则直接替换
		if (action instanceof Function) {
			hook.state = action(hook.state);
		} else {
			hook.state = action;
		}
	});

	// 修改状态
	const setState = (action) => {
		// hook保存本次修改状态的更新，保存完更新内容后重新开启渲染任务
		// 在下一次渲染任务中将会执行action，更新state的值，渲染新的页面
		hook.queue.push(action);
		// 重新开启渲染任务，渲染新的页面
		wipRoot = {
			dom: currentRoot.dom,
			props: currentRoot.props,
			alternate: currentRoot,
		};
		nextUnitOfwork = wipRoot;
		deletions = [];
	};
	// hook保存在当前函数组件生成的fiber中
	wipFiber.hooks.push(hook);
	hookIndex++;
	return [hook.state, setState];
}

// 定义effect hook
function useEffect(fn, arr){
	
}

// 为fiber节点创建dom
function createDom(fiber) {
	// 根据是否为文本节点创建dom
	const dom =
		fiber.type === "TEXT_ELEMENT"
			? document.createTextNode("")
			: document.createElement(fiber.type);

	// 根据props的内容更新dom
	updateDom(dom, {}, fiber.props);

	return dom;
}

// 创建节点的虚拟dom
function createElement(type, props, ...children) {
	// 从第三个参数开始之后的参数都是子节点
	// 使用扩展运算符将其组合为数组
	return {
		type,
		props: {
			...props,
			// 遍历所有子节点，文本节点特殊处理
			// 某些子节点本身可能已经是数组，所以需要做一次铺平处理
			children: children.flat().map((child) => {
				return typeof child === "object" ? child : createTextElement(child);
			}),
		},
	};
}

// 创建文本节点的虚拟dom
function createTextElement(text) {
	return {
		// 文本节点特殊type标识
		type: "TEXT_ELEMENT",
		props: {
			nodeValue: text,
			children: [],
		},
	};
}

// 判断某个props是否为事件
const isEvent = (key) => key.startsWith("on");
// style属性特殊处理
const isStyle = (key) => key === "style";
// 剔除children属性、事件类型、和style属性 props
const isProperty = (key) =>
	key !== "children" && !isEvent(key) && !isStyle(key);
// 判断某个props是否需要更新，新增也是更新的一种
const isNew = (prev, next) => (key) => prev[key] !== next[key];
// 判断某个props是否需要删除
const isGone = (prev, next) => (key) => !(key in next);
// 更新dom，新增也属于更新，
function updateDom(dom, prevProps, nextProps) {
	// 遍历更新前的事件类型props，删除已经不存在的事件监听
	Object.keys(prevProps)
		.filter(isEvent)
		.filter((key) => !(key in nextProps) || isNew(prevProps, nextProps)(key))
		.forEach((name) => {
			const eventType = name.toLowerCase().substring(2);
			dom.removeEventListener(eventType, prevProps[name]);
		});

	// 遍历更新前的props，将需要删除的props置空
	Object.keys(prevProps)
		.filter(isProperty)
		.filter(isGone(prevProps, nextProps))
		.forEach((name) => {
			dom[name] = "";
		});

	// 遍历更新后的props，将新增的props赋值给dom
	Object.keys(nextProps)
		.filter(isProperty)
		.filter(isNew(prevProps, nextProps))
		.forEach((name) => {
			dom[name] = nextProps[name];
		});

	// 取出更新后的style，设置style
	if (nextProps.style) {
		const style = nextProps.style;
		for (key in style) {
			dom.style[key] = style[key];
		}
	}

	// 遍历更新后的事件类型props，设置新的事件监听
	Object.keys(nextProps)
		.filter(isEvent)
		.filter(isNew(prevProps, nextProps))
		.forEach((name) => {
			const eventType = name.toLowerCase().substring(2);
			dom.addEventListener(eventType, nextProps[name]);
		});
}

// 统一提交处理好的dom
function commitRoot() {
	// 执行删除提交，删除dom
	deletions.forEach(commitWork);
	// 执行提交，将根节点的子节点提交到dom
	// 根节点wipRoot是一个容器节点，它的子节点才是需要被渲染的dom树
	commitWork(wipRoot.child);
	// 完成提交后，将currentRoot设置为当前页面中渲染的根fiber节点
	currentRoot = wipRoot;
	// 清空本次工作流中已经完成渲染的根节点
	wipRoot = null;
}

// 执行提交任务
function commitWork(fiber) {
	// 提交任务会递归执行，当fiber不存在时表示递归结束
	if (!fiber) {
		return;
	}
	// 获取当前fiber节点的父节点
	// 函数组件是没有dom内容的，函数组件运行结果得到的子组件才可能会有dom，所以递归向上寻找，找到第一个存在dom的节点
	let domParentFiber = fiber.parent;
	while (!domParentFiber.dom) {
		domParentFiber = domParentFiber.parent;
	}
	// 获取父fiber节点的dom，它是当前fiber节点在dom树中的父元素
	const domParent = domParentFiber.dom;
	// 根据effectTag执行对应的操作
	if (fiber.effectTag === "PLACEMENT" && fiber.dom != null) {
		// 新增节点
		domParent.appendChild(fiber.dom);
	} else if (fiber.effectTag === "UPDATE" && fiber.dom != null) {
		// 更新节点
		updateDom(fiber.dom, fiber.alternate.props, fiber.props);
	} else if (fiber.effectTag === "DELETION") {
		// 删除节点
		commitDeletion(fiber, domParent);
	}

	// 递归执行提交任务，深度优先遍历
	commitWork(fiber.child);
	commitWork(fiber.sibling);
}

// 提交删除节点任务
function commitDeletion(fiber, domParent) {
	// 删除对应dom，当前fiber节点为函数组件时没有dom，递归找到有dom的子节点进行删除
	if (fiber.dom) {
		domParent.removeChild(fiber.dom);
	} else {
		commitDeletion(fiber.child, domParent);
	}
}
